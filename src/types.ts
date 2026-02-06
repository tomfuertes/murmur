export type MusicalKey = "C" | "D" | "E" | "F" | "G" | "A" | "B";
export type MusicalMode = "major" | "minor" | "dorian" | "mixolydian";
export type InstrumentType = "pad" | "pluck" | "bass" | "bells" | "noise";

export interface VibeState {
  tempo: number; // 40–120 BPM
  key: MusicalKey;
  mode: MusicalMode;
  reverbMix: number; // 0–1
  delayMix: number; // 0–1
  filterCutoff: number; // 200–8000 Hz
  density: number; // 0–1 (notes per beat)
  brightness: number; // 0–1
  instruments: InstrumentType[];
  seed: number; // shared seed for deterministic note sequences
  description: string; // 1-sentence LLM-generated vibe description
}

export interface VibePrompt {
  id: string;
  author_name: string;
  text: string;
  created_at: string;
}

export interface RoomState {
  listenerCount: number;
}

export type VibeMessage =
  | { type: "vibe_state"; state: VibeState; recentPrompts: VibePrompt[] }
  | { type: "vibe_updated"; state: VibeState; prompt: VibePrompt }
  | { type: "prompt_rejected"; error: string };
