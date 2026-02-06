# Cloudflare Agents SDK + Vite — Soundscape Project

## What This Is
Shared ambient vibe room on Cloudflare. Users submit text prompts to shift a generative soundscape. All connected listeners hear the same evolving music. Server interprets prompts via LLM into musical parameter deltas, clients synthesize audio via Tone.js.

## Architecture
- **Runtime**: Cloudflare Workers + Durable Objects (Agents SDK v0.3.10)
- **Frontend**: React 19 + Tailwind v4, built with Vite + `@cloudflare/vite-plugin`
- **Audio**: Tone.js for client-side generative ambient synthesis (Web Audio API)
- **Real-time**: WebSocket via `useAgent()` hook, `broadcast()` for state fan-out
- **AI**: Llama 3.1 8B on Workers AI interprets text prompts into parameter deltas

## Key Files
- `src/server.ts` — DO class `VibeRoom` + fetch handler
- `src/hooks/useVibe.ts` — Client-side hook wrapping `useAgent()`
- `src/audio/engine.ts` — Tone.js generative engine
- `src/audio/scales.ts` — Scale/mode note mappings + seeded PRNG
- `src/components/Room.tsx` — Main UI
- `src/components/VibeForm.tsx` — Text input for submitting prompts
- `src/types.ts` — Shared types (VibeState, VibeMessage, etc.)

## Agents SDK Gotchas (from vandl)
- `@callable()` doesn't work in Vite dev mode. Use `callable()` imperatively.
- `useAgent()` untyped overload doesn't expose `.state`. Use `onStateUpdate` callback.
- `schedule(0, "methodName", payload)` for async background work.
- `broadcast()` sends raw string. Use `JSON.stringify()`.
- `this.getConnections()` for connection counting — don't maintain manual counter.
- Hibernation resets in-memory properties. Only `this.sql` and DO storage survive.

## Workers AI
- Model strings aren't in workers-types — cast as `any`.
- Llama text-gen returns `{ response: string }`.

## Vite + Cloudflare Plugin
- `index.html` must be in project root.
- Watch `.wrangler/` must be ignored in vite config.

## Core Loop
1. Server holds VibeState in SQLite
2. User submits text prompt
3. Moderation (regex + LLM)
4. LLM interprets prompt → parameter deltas
5. Server clamps deltas to ±20% of range, applies to state
6. Broadcasts new VibeState to all clients
7. Clients smoothly ramp Tone.js to new values (3s transition)

## Node / Tooling
- Node 22 required (`.node-version` file)
- `wrangler@4` recommended
