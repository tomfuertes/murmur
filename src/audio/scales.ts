import type { MusicalKey, MusicalMode } from "../types";

// Semitone intervals from root for each mode
const MODE_INTERVALS: Record<MusicalMode, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
};

const KEY_TO_MIDI: Record<MusicalKey, number> = {
  C: 60,
  D: 62,
  E: 64,
  F: 65,
  G: 67,
  A: 69,
  B: 71,
};

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function midiToNoteName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  const note = NOTE_NAMES[midi % 12];
  return `${note}${octave}`;
}

/**
 * Build an array of Tone.js note names for the given key/mode,
 * spanning from octave 2 to octave 6 (for different instrument ranges).
 */
export function getScaleNotes(key: MusicalKey, mode: MusicalMode): string[] {
  const root = KEY_TO_MIDI[key];
  const intervals = MODE_INTERVALS[mode];
  const notes: string[] = [];

  // Cover octaves 2–6 (MIDI 36–96)
  for (let octaveOffset = -24; octaveOffset <= 24; octaveOffset += 12) {
    for (const interval of intervals) {
      const midi = root + octaveOffset + interval;
      if (midi >= 36 && midi <= 96) {
        notes.push(midiToNoteName(midi));
      }
    }
  }
  return notes;
}

/**
 * Get chord tones (1, 3, 5) from the scale for pad voicings.
 */
export function getChordNotes(key: MusicalKey, mode: MusicalMode, octave: number): string[] {
  const root = KEY_TO_MIDI[key] + (octave - 4) * 12;
  const intervals = MODE_INTERVALS[mode];
  return [
    midiToNoteName(root + intervals[0]),
    midiToNoteName(root + intervals[2]),
    midiToNoteName(root + intervals[4]),
  ];
}

/**
 * Seeded PRNG (mulberry32) for deterministic note selection.
 * All clients with the same seed produce the same sequence.
 */
export function createSeededRandom(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
