import { describe, expect, it } from "vitest";
import { noteToMidi, STANDARD_TUNING } from "../music-theory";
import { estimateTempo, onsetEnvelope, trackBeats, type DetectedNote } from "./beats";
import { assignFrets } from "./fretting";
import { buildTranscription, keyFifths, spellMidi, splitDuration } from "./score";

const RIVER_TUNING = ["E2", "A2", "E3", "G3", "B3", "E4"];

/** Travis-style pattern: bass on each beat, treble on the off-beats; optional tempo drift. */
function fingerpicking({ bpm, bars, drift = 0, startAt = 0.5 }: { bpm: number; bars: number; drift?: number; startAt?: number }) {
  const notes: DetectedNote[] = [];
  const beatTimes: number[] = [];
  let t = startAt;
  for (let beat = 0; beat < bars * 4; beat++) {
    const period = (60 / bpm) * (1 + drift * Math.sin((2 * Math.PI * beat) / 16));
    beatTimes.push(t);
    const bass = beat % 2 === 0 ? 40 : 47; // E2 / B2 alternating
    notes.push({ start: t, duration: period, pitch: bass, amplitude: 0.9 });
    notes.push({ start: t + period / 2, duration: period / 2, pitch: beat % 4 < 2 ? 68 : 71, amplitude: 0.5 });
    t += period;
  }
  return { notes, beatTimes, end: t + 1 };
}

describe("tempo and beats", () => {
  it("estimates a steady tempo", () => {
    const { notes, end } = fingerpicking({ bpm: 84, bars: 16 });
    expect(estimateTempo(onsetEnvelope(notes, end))).toBeCloseTo(84, 0);
  });

  it("tracks beats through ±3% tempo drift", () => {
    const { notes, beatTimes, end } = fingerpicking({ bpm: 90, bars: 16, drift: 0.03 });
    const env = onsetEnvelope(notes, end);
    const beats = trackBeats(env, estimateTempo(env));
    // Every true beat should have a tracked beat within 30 ms.
    const misses = beatTimes.filter((bt) => !beats.some((b) => Math.abs(b - bt) < 0.03));
    expect(misses.length).toBe(0);
  });
});

describe("fretting", () => {
  const standard = STANDARD_TUNING.map(noteToMidi);

  it("plays an open E major chord shape in first position", () => {
    // E2 B2 E3 G#3 B3 E4
    const { events, dropped } = assignFrets([[40, 47, 52, 56, 59, 64]], standard);
    expect(dropped).toBe(0);
    const byString = Object.fromEntries(events[0].map((n) => [n.string, n.fret]));
    expect(byString).toEqual({ 6: 0, 5: 2, 4: 2, 3: 1, 2: 0, 1: 0 });
  });

  it("uses the raised 4th string in EAEGBE", () => {
    // E3 is the open 4th string in River Song's tuning.
    const { events } = assignFrets([[52]], RIVER_TUNING.map(noteToMidi));
    expect(events[0]).toEqual([{ pitch: 52, string: 4, fret: 0 }]);
  });

  it("drops notes below the lowest string", () => {
    const { events, dropped } = assignFrets([[30, 64]], standard);
    expect(dropped).toBe(1);
    expect(events[0].map((n) => n.pitch)).toEqual([64]);
  });

  it("keeps the hand in place across a phrase", () => {
    // A melody around the 5th–7th frets should not jump between positions.
    const melody = [69, 71, 72, 74, 72, 71, 69].map((p) => [p]);
    const { events } = assignFrets(melody, standard);
    const frets = events.flat().map((n) => n.fret).filter((f) => f > 0);
    expect(Math.max(...frets) - Math.min(...frets)).toBeLessThanOrEqual(5);
  });
});

describe("score helpers", () => {
  it("splits durations into notatable values", () => {
    expect(splitDuration(4)).toEqual([4]);
    expect(splitDuration(5)).toEqual([4, 1]);
    expect(splitDuration(7)).toEqual([6, 1]);
    expect(splitDuration(16)).toEqual([16]);
  });

  it("computes key signatures", () => {
    expect(keyFifths({ tonic: "E", mode: "major" })).toBe(4);
    expect(keyFifths({ tonic: "Bb", mode: "minor" })).toBe(-5);
    expect(keyFifths({ tonic: "A", mode: "minor" })).toBe(0);
  });

  it("spells notes for the key", () => {
    expect(spellMidi(56, { tonic: "E", mode: "major" })).toEqual({ step: "G", alter: 1, octave: 3 });
    expect(spellMidi(56, { tonic: "Bb", mode: "minor" })).toEqual({ step: "A", alter: -1, octave: 3 });
    expect(spellMidi(40, { tonic: "E", mode: "major" })).toEqual({ step: "E", alter: 0, octave: 2 });
  });
});

describe("buildTranscription", () => {
  const opts = { title: "Test & <Song>", key: { tonic: "E", mode: "major" } as const, tuning: RIVER_TUNING };

  it("produces bars, sync points and MusicXML", () => {
    const { notes, beatTimes, end } = fingerpicking({ bpm: 84, bars: 8 });
    const t = buildTranscription(notes, { ...opts, duration: end });
    expect(t.bpm).toBeCloseTo(84, 0);
    expect(t.bars).toBe(8);
    expect(t.notes).toBe(notes.length);
    expect(t.dropped).toBe(0);
    expect(t.musicXml.match(/<measure /g)).toHaveLength(8);
    expect(t.musicXml).toContain("<fifths>4</fifths>");
    expect(t.musicXml).toContain("Test &amp; &lt;Song&gt;");
    // Every bar's sync point lands on the true downbeat.
    t.syncPoints.forEach((sp, bar) => expect(Math.abs(sp.millisecondOffset - beatTimes[bar * 4] * 1000)).toBeLessThan(30));
  });

  it("fills every bar to exactly four beats", () => {
    const { notes, end } = fingerpicking({ bpm: 96, bars: 6, drift: 0.02 });
    const t = buildTranscription(notes, { ...opts, duration: end });
    for (const measure of t.musicXml.split("<measure ").slice(1)) {
      // Sum durations of notes that aren't chord members.
      const total = [...measure.matchAll(/<note>([\s\S]*?)<\/note>/g)]
        .filter((m) => !m[1].includes("<chord/>"))
        .reduce((sum, m) => sum + Number(/<duration>(\d+)<\/duration>/.exec(m[1])![1]), 0);
      expect(total).toBe(16);
    }
  });
});
