/**
 * Keys and diatonic triads (major and natural minor).
 *
 * Notes are spelled by letter, so each scale uses every letter A–G exactly once
 * (D major → F♯ and C♯, never G♭/D♭; F major → B♭, never A♯).
 *
 * Tonics are stored in ASCII ("F#", "Bb"); use `prettyNote` for display.
 */

export type Letter = "C" | "D" | "E" | "F" | "G" | "A" | "B";
export type Tonic = `${Letter}${"" | "#" | "b"}`;
export type Mode = "major" | "minor";
export type TriadQuality = "major" | "minor" | "diminished" | "augmented";

export interface Key {
  tonic: Tonic;
  mode: Mode;
}

export interface DiatonicChord {
  degree: number; // 1–7
  numeral: string; // e.g. "ii", "vii°", "III"
  root: string; // ASCII, e.g. "F#"
  quality: TriadQuality;
  name: string; // ASCII, e.g. "F#m", "F#°"
  notes: [string, string, string]; // root, third, fifth (ASCII)
}

const LETTERS: Letter[] = ["C", "D", "E", "F", "G", "A", "B"];
const NATURAL_PITCH: Record<Letter, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Semitones from the tonic for each scale degree. */
const SCALE_STEPS: Record<Mode, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10], // natural minor
};

const NUMERALS = ["i", "ii", "iii", "iv", "v", "vi", "vii"];

const mod12 = (n: number) => ((n % 12) + 12) % 12;

function parseNote(note: string): { letter: Letter; pitch: number } {
  const match = /^([A-G])(#{1,2}|b{1,2})?$/.exec(note);
  if (!match) throw new Error(`Invalid note: ${note}`);
  const letter = match[1] as Letter;
  const acc = match[2] ?? "";
  const offset = acc.startsWith("#") ? acc.length : -acc.length;
  return { letter, pitch: mod12(NATURAL_PITCH[letter] + offset) };
}

/** Pitch class 0–11 (C = 0) of a note name such as "F#" or "Bb". */
export function pitchClass(note: string): number {
  return parseNote(note).pitch;
}

/** Spell a pitch class on a given letter, e.g. (6, "F") → "F#", (6, "G") → "Gb". */
function spell(letter: Letter, pitch: number): string {
  let diff = mod12(pitch - NATURAL_PITCH[letter]);
  if (diff > 6) diff -= 12; // range -5..6; in practice -2..2 for real keys
  if (Math.abs(diff) > 2) throw new Error(`Cannot spell pitch ${pitch} on ${letter}`);
  return letter + (diff > 0 ? "#".repeat(diff) : "b".repeat(-diff));
}

export function scaleNotes({ tonic, mode }: Key): string[] {
  const { letter, pitch } = parseNote(tonic);
  const start = LETTERS.indexOf(letter);
  return SCALE_STEPS[mode].map((step, i) => spell(LETTERS[(start + i) % 7], pitch + step));
}

function triadQuality(third: number, fifth: number): TriadQuality {
  if (third === 4 && fifth === 7) return "major";
  if (third === 3 && fifth === 7) return "minor";
  if (third === 3 && fifth === 6) return "diminished";
  if (third === 4 && fifth === 8) return "augmented";
  throw new Error(`Not a tertian triad: ${third}/${fifth}`);
}

const QUALITY_SUFFIX: Record<TriadQuality, string> = {
  major: "",
  minor: "m",
  diminished: "°",
  augmented: "+",
};

function numeralFor(degree: number, quality: TriadQuality): string {
  const base = NUMERALS[degree - 1];
  switch (quality) {
    case "major":
      return base.toUpperCase();
    case "augmented":
      return base.toUpperCase() + "+";
    case "minor":
      return base;
    case "diminished":
      return base + "°";
  }
}

export function diatonicTriads(key: Key): DiatonicChord[] {
  const notes = scaleNotes(key);
  return notes.map((root, i) => {
    const third = notes[(i + 2) % 7];
    const fifth = notes[(i + 4) % 7];
    const r = parseNote(root).pitch;
    const quality = triadQuality(mod12(parseNote(third).pitch - r), mod12(parseNote(fifth).pitch - r));
    return {
      degree: i + 1,
      numeral: numeralFor(i + 1, quality),
      root,
      quality,
      name: root + QUALITY_SUFFIX[quality],
      notes: [root, third, fifth],
    };
  });
}

// ---- Guitar tuning ----

/** Strings low → high with octave (scientific pitch), e.g. ["E2", "A2", "D3", "G3", "B3", "E4"]. */
export type Tuning = string[];

export const STANDARD_TUNING: Tuning = ["E2", "A2", "D3", "G3", "B3", "E4"];

/** MIDI note number of a note with octave, e.g. "E2" → 40, "C4" → 60, "F#3" → 54. */
export function noteToMidi(note: string): number {
  const match = /^([A-G](?:#{1,2}|b{1,2})?)(-?\d)$/.exec(note);
  if (!match) throw new Error(`Invalid note with octave: ${note}`);
  const name = match[1];
  const octave = Number(match[2]);
  const { letter } = parseNote(name);
  // Use the raw offset (not mod 12) so "Cb4" is B3 and "B#3" is C4.
  const offset = name.slice(1).startsWith("#") ? name.length - 1 : -(name.length - 1);
  return 12 * (octave + 1) + NATURAL_PITCH[letter] + offset;
}

/** Semitones each string is retuned from standard (+ up, − down). Six-string tunings only. */
export function tuningOffsets(tuning: Tuning): number[] {
  if (tuning.length !== STANDARD_TUNING.length) throw new Error("Expected a six-string tuning");
  return tuning.map((note, i) => noteToMidi(note) - noteToMidi(STANDARD_TUNING[i]));
}

/** "F#" → "F♯", "Bbb" → "B𝄫", "C##" → "C𝄪" */
export function prettyNote(note: string): string {
  return note.replace("##", "𝄪").replace("bb", "𝄫").replace("#", "♯").replace(/(?<=^[A-G])b/, "♭");
}

export function keyName({ tonic, mode }: Key): string {
  return `${prettyNote(tonic)} ${mode}`;
}
