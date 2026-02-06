import { Agent, callable, routeAgentRequest, getCurrentAgent } from "agents";
import type { Connection, ConnectionContext } from "agents";
import type { VibeState, VibePrompt, RoomState, VibeMessage, MusicalKey, MusicalMode, InstrumentType } from "./types";

interface Env {
  AI: Ai;
  VIBE_ROOM: DurableObjectNamespace;
  TURNSTILE_SECRET: string;
}

const registerCallable = callable();

// --- Rate limiting ---
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_PER_IP_WRITE = 3;
const RATE_LIMIT_GLOBAL_WRITE = 30;

// --- Content pre-filter (fast blocklist before LLM moderation) ---
const PROFANITY_RE = new RegExp(
  atob("XGIobmlnZyg/OmVyfGEpfGZhZyg/OmdvdCk/fHJldGFyZHxraWtlfHNwaWN8Y2hpbmt8dHJhbm55fGN1bnR8Y29ja1xzKnN1Y2t8Ymxvd1xzKmpvYnxnYW5nXHMqYmFuZ3xjaGlsZFxzKnBvcm58a2lkZGllXHMqcG9ybnxraWxsXHMqKD86eW91cik/c2VsZilcYg=="),
  "i"
);

function containsProfanity(text: string): boolean {
  return PROFANITY_RE.test(text);
}

// --- Input sanitization ---
const HTML_TAG_RE = /<[^>]*>/g;
const SCRIPT_RE = /javascript:|on\w+\s*=|<script|<iframe|<object|<embed/i;
const SQL_INJECT_RE = /(\b(DROP|DELETE|INSERT|UPDATE|ALTER|EXEC|UNION)\b.*\b(TABLE|FROM|INTO|SET)\b)|(--.*)|(;.*\b(DROP|DELETE)\b)/i;

function sanitizeInput(text: string): { clean: string; rejected: string | null } {
  const stripped = text.replace(HTML_TAG_RE, "").trim();
  if (SCRIPT_RE.test(text)) return { clean: "", rejected: "Input contains prohibited content." };
  if (SQL_INJECT_RE.test(text)) return { clean: "", rejected: "Input contains prohibited content." };
  if (stripped.length === 0) return { clean: "", rejected: "Text cannot be empty." };
  if (stripped.length > 200) return { clean: stripped.slice(0, 200), rejected: null };
  return { clean: stripped, rejected: null };
}

// --- VibeState parameter ranges for clamping ---
const PARAM_RANGES: Record<string, { min: number; max: number }> = {
  tempo: { min: 40, max: 120 },
  reverbMix: { min: 0, max: 1 },
  delayMix: { min: 0, max: 1 },
  filterCutoff: { min: 200, max: 8000 },
  density: { min: 0, max: 1 },
  brightness: { min: 0, max: 1 },
  seed: { min: 1, max: 999999 },
};

const VALID_KEYS: MusicalKey[] = ["C", "D", "E", "F", "G", "A", "B"];
const VALID_MODES: MusicalMode[] = ["major", "minor", "dorian", "mixolydian"];
const VALID_INSTRUMENTS: InstrumentType[] = ["pad", "pluck", "bass", "bells", "noise"];

const DEFAULT_VIBE_STATE: VibeState = {
  tempo: 72,
  key: "C",
  mode: "minor",
  reverbMix: 0.4,
  delayMix: 0.2,
  filterCutoff: 3000,
  density: 0.4,
  brightness: 0.5,
  instruments: ["pad", "pluck", "bass"],
  seed: 42,
  description: "A calm, contemplative ambient space.",
};

export class VibeRoom extends Agent<Env, RoomState> {
  initialState: RoomState = { listenerCount: 0 };

  private readonly MAX_CONNECTIONS = 100;

  private getConnectionCount(): number {
    let count = 0;
    for (const _ of this.getConnections()) count++;
    return count;
  }

  onStart() {
    this.sql`CREATE TABLE IF NOT EXISTS vibe_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      state TEXT NOT NULL
    )`;

    this.sql`CREATE TABLE IF NOT EXISTS prompts (
      id TEXT PRIMARY KEY,
      author_name TEXT DEFAULT 'Anonymous',
      text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`;
    this.sql`CREATE INDEX IF NOT EXISTS idx_prompts_created_at ON prompts(created_at DESC)`;

    this.sql`CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY,
      timestamps TEXT NOT NULL DEFAULT '[]'
    )`;

    // Initialize vibe state if not present
    const existing = this.sql<{ state: string }>`SELECT state FROM vibe_state WHERE id = 1`[0];
    if (!existing) {
      this.sql`INSERT INTO vibe_state (id, state) VALUES (1, ${JSON.stringify(DEFAULT_VIBE_STATE)})`;
    }

    registerCallable(this.submitPrompt, { kind: "method", name: "submitPrompt" } as any);
  }

  private getVibeState(): VibeState {
    const row = this.sql<{ state: string }>`SELECT state FROM vibe_state WHERE id = 1`[0];
    if (!row) return { ...DEFAULT_VIBE_STATE };
    try {
      return JSON.parse(row.state);
    } catch {
      return { ...DEFAULT_VIBE_STATE };
    }
  }

  private setVibeState(state: VibeState) {
    this.sql`UPDATE vibe_state SET state = ${JSON.stringify(state)} WHERE id = 1`;
  }

  private getClientIp(): string {
    const { connection, request } = getCurrentAgent();
    const connIp = (connection?.state as { ip?: string } | null)?.ip;
    if (connIp) return connIp;
    return request?.headers.get("CF-Connecting-IP") ?? "unknown-ip";
  }

  private async verifyTurnstile(token: string | undefined) {
    if (!token) throw new Error("Bot verification required.");
    const ip = this.getClientIp();
    const resp = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret: this.env.TURNSTILE_SECRET,
          response: token,
          remoteip: ip,
        }),
      }
    );
    const result = (await resp.json()) as { success: boolean };
    if (!result.success) throw new Error("Bot verification failed.");
  }

  private checkRateLimit(key: string, limit: number): string | null {
    try {
      const now = Date.now();
      const windowStart = now - RATE_LIMIT_WINDOW_MS;
      const row = this.sql<{ timestamps: string }>`
        SELECT timestamps FROM rate_limits WHERE key = ${key}
      `[0];

      let timestamps: number[];
      if (row) {
        try {
          const parsed = JSON.parse(row.timestamps);
          timestamps = Array.isArray(parsed) ? parsed : [];
        } catch {
          console.error(`Corrupted rate_limits row for key="${key}", resetting`);
          this.sql`DELETE FROM rate_limits WHERE key = ${key}`;
          timestamps = [];
        }
      } else {
        timestamps = [];
      }

      timestamps = timestamps.filter((t) => t > windowStart);

      if (timestamps.length >= limit) {
        const retryIn = Math.ceil((timestamps[0] + RATE_LIMIT_WINDOW_MS - now) / 1000);
        this.sql`INSERT OR REPLACE INTO rate_limits (key, timestamps)
          VALUES (${key}, ${JSON.stringify(timestamps)})`;
        return `Rate limited. Try again in ${retryIn}s`;
      }

      if (timestamps.length === 0 && row) {
        this.sql`DELETE FROM rate_limits WHERE key = ${key}`;
      }

      timestamps.push(now);
      this.sql`INSERT OR REPLACE INTO rate_limits (key, timestamps)
        VALUES (${key}, ${JSON.stringify(timestamps)})`;
      return null;
    } catch (err) {
      console.error(`Rate limiter error for key="${key}":`, err);
      return null; // Fail open
    }
  }

  onConnect(connection: Connection, ctx: ConnectionContext) {
    if (this.getConnectionCount() >= this.MAX_CONNECTIONS) {
      connection.close(1013, "Too many connections");
      return;
    }

    const ip = ctx.request.headers.get("CF-Connecting-IP") ?? "unknown-ip";
    connection.setState({ ip });

    // Send current vibe state + recent prompts
    const state = this.getVibeState();
    const recentPrompts = this.sql<VibePrompt>`
      SELECT id, author_name, text, created_at
      FROM prompts ORDER BY created_at DESC LIMIT 20
    `.reverse();

    const msg: VibeMessage = { type: "vibe_state", state, recentPrompts };
    connection.send(JSON.stringify(msg));

    this.updateListenerCount();
  }

  onClose() {
    this.updateListenerCount();
  }

  private updateListenerCount() {
    const count = this.getConnectionCount();
    this.setState({ listenerCount: count });
  }

  async submitPrompt(text: string, authorName?: string, turnstileToken?: string) {
    await this.verifyTurnstile(turnstileToken);

    // Rate limit: global first
    const globalError = this.checkRateLimit("global:write", RATE_LIMIT_GLOBAL_WRITE);
    if (globalError) throw new Error("The room is busy. Try again in a moment.");
    const ip = this.getClientIp();
    const perIpError = this.checkRateLimit(`ip:write:${ip}`, RATE_LIMIT_PER_IP_WRITE);
    if (perIpError) throw new Error(perIpError);

    // Input sanitization
    const { clean: cleanText, rejected } = sanitizeInput(text);
    if (rejected) throw new Error(rejected);

    // Pre-filter profanity
    if (containsProfanity(cleanText)) {
      throw new Error("Content flagged by moderation.");
    }

    const name = sanitizeInput(authorName ?? "").clean.slice(0, 50) || "Anonymous";
    const id = crypto.randomUUID();

    // Store prompt
    this.sql`INSERT INTO prompts (id, author_name, text) VALUES (${id}, ${name}, ${cleanText})`;

    // Process via LLM in background
    this.schedule(0, "processPrompt", { id, text: cleanText });

    return { id };
  }

  async processPrompt(payload: { id: string; text: string }) {
    const { id, text } = payload;
    try {
      // Step 1: LLM content moderation
      const moderationResponse = (await this.env.AI.run(
        "@cf/meta/llama-3.1-8b-instruct" as any,
        {
          messages: [
            {
              role: "system",
              content:
                "You are a content moderator. Classify the following user text as SAFE or UNSAFE. UNSAFE means: sexually explicit, violent/gory, illegal activity, hate speech, harassment, self-harm, or content involving minors inappropriately. Respond with ONLY one word: SAFE or UNSAFE.",
            },
            { role: "user", content: text },
          ],
          max_tokens: 5,
        }
      )) as { response?: string };

      const verdict = moderationResponse.response?.trim().toUpperCase();
      if (verdict !== "SAFE") {
        this.broadcastRejection(id, "Content flagged by moderation.");
        return;
      }

      // Step 2: Interpret prompt as musical parameter deltas
      const currentState = this.getVibeState();
      const llmResponse = (await this.env.AI.run(
        "@cf/meta/llama-3.1-8b-instruct" as any,
        {
          messages: [
            {
              role: "system",
              content: `You are a musical atmosphere interpreter. You translate text descriptions into musical parameter changes for a generative ambient music engine.

Current state: ${JSON.stringify({
                tempo: currentState.tempo,
                key: currentState.key,
                mode: currentState.mode,
                reverbMix: currentState.reverbMix,
                delayMix: currentState.delayMix,
                filterCutoff: currentState.filterCutoff,
                density: currentState.density,
                brightness: currentState.brightness,
                instruments: currentState.instruments,
              })}

Parameter ranges:
- tempo: 40-120 BPM (deltas: -16 to +16)
- key: C, D, E, F, G, A, B (set directly, not delta)
- mode: major, minor, dorian, mixolydian (set directly, not delta)
- reverbMix: 0-1 (deltas: -0.2 to +0.2)
- delayMix: 0-1 (deltas: -0.2 to +0.2)
- filterCutoff: 200-8000 Hz (deltas: -1560 to +1560)
- density: 0-1 (deltas: -0.2 to +0.2)
- brightness: 0-1 (deltas: -0.2 to +0.2)
- instruments: array of active types from [pad, pluck, bass, bells, noise] (set directly)
- seed: 1-999999 (set directly, not delta — change to a new random integer if the mood shifts significantly, otherwise keep current)

Respond with ONLY valid JSON. Two fields:
1. "deltas" — object with only changed parameters. Numeric params use delta values. "key", "mode", "instruments" are set directly.
2. "description" — one sentence describing the new vibe.

Example: {"deltas":{"tempo":8,"reverbMix":0.15,"mode":"minor","brightness":-0.1},"description":"A darker, spacious atmosphere with a contemplative pulse."}`,
            },
            { role: "user", content: text },
          ],
          max_tokens: 200,
        }
      )) as { response?: string };

      const rawResponse = llmResponse.response?.trim() || "{}";

      // Extract JSON from response (LLM might wrap in markdown code blocks)
      let jsonStr = rawResponse;
      const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) jsonStr = jsonMatch[0];

      let parsed: { deltas?: Record<string, unknown>; description?: string };
      try {
        parsed = JSON.parse(jsonStr);
      } catch {
        console.error("LLM returned invalid JSON:", rawResponse);
        parsed = { deltas: {}, description: "The vibe continues to evolve." };
      }

      const deltas = parsed.deltas || {};
      const description = (typeof parsed.description === "string" ? parsed.description : "The vibe continues to evolve.").slice(0, 200);

      // Apply deltas with clamping
      const newState = { ...currentState };

      for (const [param, range] of Object.entries(PARAM_RANGES)) {
        if (param in deltas) {
          const delta = Number(deltas[param]);
          if (!isNaN(delta)) {
            const maxDelta = (range.max - range.min) * 0.2;
            const clampedDelta = Math.max(-maxDelta, Math.min(maxDelta, delta));
            (newState as any)[param] = Math.max(
              range.min,
              Math.min(range.max, (currentState as any)[param] + clampedDelta)
            );
          }
        }
      }

      // Key (set directly, not delta)
      if (deltas.key && VALID_KEYS.includes(deltas.key as MusicalKey)) {
        newState.key = deltas.key as MusicalKey;
      }

      // Mode (set directly)
      if (deltas.mode && VALID_MODES.includes(deltas.mode as MusicalMode)) {
        newState.mode = deltas.mode as MusicalMode;
      }

      // Instruments (set directly, validate each)
      if (Array.isArray(deltas.instruments)) {
        const validInstruments = (deltas.instruments as string[]).filter(
          (i) => VALID_INSTRUMENTS.includes(i as InstrumentType)
        ) as InstrumentType[];
        if (validInstruments.length > 0) {
          newState.instruments = validInstruments;
        }
      }

      // Seed (set directly if provided)
      if (deltas.seed !== undefined) {
        const seedVal = Number(deltas.seed);
        if (!isNaN(seedVal) && seedVal >= 1 && seedVal <= 999999) {
          newState.seed = Math.round(seedVal);
        }
      }

      newState.description = description;

      // Persist
      this.setVibeState(newState);

      // Build prompt object
      const promptRow = this.sql<VibePrompt>`SELECT id, author_name, text, created_at FROM prompts WHERE id = ${id}`[0];
      const prompt: VibePrompt = promptRow || { id, author_name: "Anonymous", text, created_at: new Date().toISOString() };

      // Broadcast
      const msg: VibeMessage = { type: "vibe_updated", state: newState, prompt };
      this.broadcast(JSON.stringify(msg));
    } catch (err) {
      console.error("processPrompt failed:", err);
      this.broadcastRejection(id, "Failed to process your vibe. Try again.");
    }
  }

  private broadcastRejection(promptId: string, error: string) {
    try {
      // Delete the prompt since it was rejected
      this.sql`DELETE FROM prompts WHERE id = ${promptId}`;
      const msg: VibeMessage = { type: "prompt_rejected", error };
      this.broadcast(JSON.stringify(msg));
    } catch (err) {
      console.error("Failed to broadcast rejection:", err);
    }
  }
}

// Allowlist for DO instance names
const ALLOWED_INSTANCE_NAMES = new Set(["room"]);

const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; connect-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; frame-src https://challenges.cloudflare.com",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
} as const;

function withSecurityHeaders(response: Response): Response {
  if (response.status === 101 || (response as any).webSocket) {
    return response;
  }
  const secured = new Response(response.body, response);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    secured.headers.set(key, value);
  }
  return secured;
}

export default {
  async fetch(request: Request, env: Env) {
    try {
      const url = new URL(request.url);

      const agentMatch = url.pathname.match(/^\/agents\/[^/]+\/([^/]+)/);
      if (agentMatch) {
        const instanceName = decodeURIComponent(agentMatch[1]);
        if (!ALLOWED_INSTANCE_NAMES.has(instanceName)) {
          return withSecurityHeaders(new Response("Not found", { status: 404 }));
        }
      }

      const response =
        (await routeAgentRequest(request, env)) ||
        new Response("Not found", { status: 404 });

      return withSecurityHeaders(response);
    } catch (err) {
      console.error("Unhandled fetch error:", err);
      return new Response("Internal server error", {
        status: 500,
        headers: SECURITY_HEADERS,
      });
    }
  },
} satisfies ExportedHandler<Env>;
