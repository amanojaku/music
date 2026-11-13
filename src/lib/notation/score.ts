/**
 * Turn detected notes into a draft score: MusicXML (standard notation + tab
 * fingering in the track's tuning) plus per-bar sync points that map each
 * barline to its time in the recording.
 *
 * The draft is deliberately simple — a single voice on a 16th-note grid, each
 * chord lasting until the next — and meant to be tidied in MuseScore.
 */

import { pitchClass, scaleNotes, noteToMidi, type Key, type Tuning } from "../music-theory";
import {
  chooseDownbeat,
  estimateTempo,
  extendBeats,
  onsetEnvelope,
  trackBeats,
  type DetectedNote,
} from "./beats";
import { assignFrets, type FrettedNote } from "./fretting";

/** Same shape as alphaTab's FlatSyncPoint. */
export interface SyncPoint {
  barIndex: number;
  barPosition: number;
  barOccurence: number;
  millisecondOffset: number;
}

export interface TranscriptionOptions {
  title: string;
  key: Key;
  tuning: Tuning;
  /** Recording length in seconds. */
  duration: number;
  beatsPerBar?: number;
  /** Override the detected tempo. */
  bpm?: number;
  /** Move the barlines by this many beats if the detected downbeat is wrong (+ later, − earlier). */
  shiftBeats?: number;
}

export interface Transcription {
  musicXml: string;
  syncPoints: SyncPoint[];
  bpm: number;
  bars: number;
  events: number;
  notes: number;
  dropped: number;
}

/** Grid steps per beat (16th notes in x/4 time). */
const STEPS_PER_BEAT = 4;

const DURATIONS: Array<{ steps: number; type: string; dotted: boolean }> = [
  { steps: 16, type: "whole", dotted: false },
  { steps: 12, type: "half", dotted: true },
  { steps: 8, type: "half", dotted: false },
  { steps: 6, type: "quarter", dotted: true },
  { steps: 4, type: "quarter", dotted: false },
  { steps: 3, type: "eighth", dotted: true },
  { steps: 2, type: "eighth", dotted: false },
  { steps: 1, type: "16th", dotted: false },
];

/** Split a length in grid steps into notatable durations (largest first). */
export function splitDuration(steps: number): number[] {
  const parts: number[] = [];
  let left = steps;
  while (left > 0) {
    const d = DURATIONS.find((d) => d.steps <= left)!;
    parts.push(d.steps);
    left -= d.steps;
  }
  return parts;
}

/** Key signature as MusicXML <fifths>: sharps positive, flats negative. */
export function keyFifths(key: Key): number {
  return scaleNotes(key).reduce((n, note) => n + (note.match(/#/g)?.length ?? 0) - (note.match(/b/g)?.length ?? 0), 0);
}

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

/** Spell a MIDI note in the key: scale notes use the key's spelling, others follow the signature. */
export function spellMidi(midi: number, key: Key): { step: string; alter: number; octave: number } {
  const pc = ((midi % 12) + 12) % 12;
  const scale = scaleNotes(key);
  const name =
    scale.find((n) => pitchClass(n) === pc) ?? (keyFifths(key) >= 0 ? SHARP_NAMES[pc] : FLAT_NAMES[pc]);
  const alter = (name.match(/#/g)?.length ?? 0) - (name.match(/b/g)?.length ?? 0);
  return { step: name[0], alter, octave: Math.floor((midi - alter) / 12) - 1 };
}

const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type Tie = "start" | "stop" | "both" | null;

function noteXml(note: FrettedNote | null, steps: number, chord: boolean, tie: Tie, key: Key): string {
  const d = DURATIONS.find((x) => x.steps === steps)!;
  const ties = tie === "both" ? ["stop", "start"] : tie ? [tie] : [];
  const lines = ["      <note>"];
  if (chord) lines.push("        <chord/>");
  if (note) {
    const { step, alter, octave } = spellMidi(note.pitch, key);
    lines.push(
      `        <pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ""}<octave>${octave}</octave></pitch>`,
    );
  } else {
    lines.push("        <rest/>");
  }
  lines.push(`        <duration>${steps}</duration>`);
  ties.forEach((t) => lines.push(`        <tie type="${t}"/>`));
  lines.push("        <voice>1</voice>", `        <type>${d.type}</type>`);
  if (d.dotted) lines.push("        <dot/>");
  if (note) {
    const tied = ties.map((t) => `<tied type="${t}"/>`).join("");
    lines.push(
      `        <notations>${tied}<technical><string>${note.string}</string><fret>${note.fret}</fret></technical></notations>`,
    );
  }
  lines.push("      </note>");
  return lines.join("\n");
}

function attributesXml(opts: TranscriptionOptions, beatsPerBar: number): string {
  // MusicXML staff-tuning lines count from the bottom (lowest string = line 1).
  const tuning = opts.tuning
    .map((n, i) => {
      const [, step, accidental, octave] = /^([A-G])(#{1,2}|b{1,2})?(-?\d)$/.exec(n)!;
      const alter = accidental ? (accidental[0] === "#" ? accidental.length : -accidental.length) : 0;
      return `          <staff-tuning line="${i + 1}"><tuning-step>${step}</tuning-step>${
        alter ? `<tuning-alter>${alter}</tuning-alter>` : ""
      }<tuning-octave>${octave}</tuning-octave></staff-tuning>`;
    })
    .join("\n");
  return `      <attributes>
        <divisions>${STEPS_PER_BEAT}</divisions>
        <key><fifths>${keyFifths(opts.key)}</fifths><mode>${opts.key.mode}</mode></key>
        <time><beats>${beatsPerBar}</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef>
        <staff-details>
${tuning}
        </staff-details>
      </attributes>`;
}

export function buildTranscription(notes: DetectedNote[], opts: TranscriptionOptions): Transcription {
  const beatsPerBar = opts.beatsPerBar ?? 4;
  const stepsPerBar = beatsPerBar * STEPS_PER_BEAT;
  if (!notes.length) throw new Error("No notes detected");

  const sorted = [...notes].sort((a, b) => a.start - b.start);
  const first = sorted[0].start;
  const last = sorted[sorted.length - 1].start;

  const env = onsetEnvelope(sorted, opts.duration);
  const bpm = opts.bpm ?? estimateTempo(env);
  const barSeconds = (60 / bpm) * beatsPerBar;
  let beats = extendBeats(trackBeats(env, bpm), first, last + barSeconds, bpm);

  // Start bar 1 on the detected downbeat (optionally shifted), adding a bar before it if notes precede it.
  const shift = opts.shiftBeats ?? 0;
  const downbeat = ((chooseDownbeat(beats, sorted, beatsPerBar) + shift) % beatsPerBar + beatsPerBar) % beatsPerBar;
  beats = beats.slice(downbeat);
  if (beats[0] > first + (beats[1] - beats[0]) / 4) {
    const period = beats[1] - beats[0];
    for (let i = 0; i < beatsPerBar; i++) beats.unshift(beats[0] - period);
  }

  // Quantise onsets to the beat-relative grid and group into chords.
  const groups = new Map<number, DetectedNote[]>();
  let b = 0;
  for (const note of sorted) {
    while (b + 1 < beats.length - 1 && beats[b + 1] <= note.start) b++;
    const frac = Math.max(0, (note.start - beats[b]) / (beats[b + 1] - beats[b]));
    const step = b * STEPS_PER_BEAT + Math.round(frac * STEPS_PER_BEAT);
    groups.set(step, [...(groups.get(step) ?? []), note]);
  }
  const steps = [...groups.keys()].sort((x, y) => x - y);
  const chords = steps.map((s) =>
    [...groups.get(s)!].sort((x, y) => y.amplitude - x.amplitude).map((n) => n.pitch),
  );
  const { events, dropped } = assignFrets(chords, opts.tuning.map(noteToMidi));

  const bars = Math.floor(steps[steps.length - 1] / stepsPerBar) + 1;
  const measures: string[] = [];
  let e = 0;
  for (let bar = 0; bar < bars; bar++) {
    const barStart = bar * stepsPerBar;
    const barEnd = barStart + stepsPerBar;
    const parts: string[] = [`    <measure number="${bar + 1}">`];
    if (bar === 0) {
      parts.push(attributesXml(opts, beatsPerBar));
      parts.push(`      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${Math.round(
        bpm,
      )}</per-minute></metronome></direction-type><sound tempo="${Math.round(bpm)}"/></direction>`);
    }

    let pos = barStart;
    while (e < steps.length && steps[e] < barEnd) {
      const chord = events[e].length ? events[e] : null;
      const next = e + 1 < steps.length ? Math.min(steps[e + 1], barEnd) : barEnd;
      if (steps[e] > pos) splitDuration(steps[e] - pos).forEach((d) => parts.push(noteXml(null, d, false, null, opts.key)));
      const pieces = splitDuration(next - steps[e]);
      pieces.forEach((d, k) => {
        const tie: Tie = pieces.length === 1 ? null : k === 0 ? "start" : k === pieces.length - 1 ? "stop" : "both";
        if (!chord) parts.push(noteXml(null, d, false, null, opts.key));
        else chord.forEach((note, n) => parts.push(noteXml(note, d, n > 0, tie, opts.key)));
      });
      pos = next;
      e++;
    }
    if (pos < barEnd) splitDuration(barEnd - pos).forEach((d) => parts.push(noteXml(null, d, false, null, opts.key)));
    parts.push("    </measure>");
    measures.push(parts.join("\n"));
  }

  const musicXml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <work><work-title>${escapeXml(opts.title)}</work-title></work>
  <identification><encoding><software>my-music transcribe (Basic Pitch draft)</software></encoding></identification>
  <part-list><score-part id="P1"><part-name>Guitar</part-name></score-part></part-list>
  <part id="P1">
${measures.join("\n")}
  </part>
</score-partwise>
`;

  const syncPoints: SyncPoint[] = Array.from({ length: bars }, (_, bar) => ({
    barIndex: bar,
    barPosition: 0,
    barOccurence: 0,
    millisecondOffset: Math.max(0, Math.round(beats[bar * beatsPerBar] * 1000)),
  }));

  return {
    musicXml,
    syncPoints,
    bpm,
    bars,
    events: steps.length,
    notes: events.reduce((n, ev) => n + ev.length, 0),
    dropped,
  };
}
