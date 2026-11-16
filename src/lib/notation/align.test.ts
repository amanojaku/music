import { describe, expect, it } from "vitest";
import { alignScore, parseScore, playThrough, type AudioNote } from "./align";

/** Minimal MusicXML: bars of quarter notes (pitches as MIDI), with optional repeat/ending markup. */
function score(bars: Array<{ notes: number[]; start?: boolean; end?: boolean; ending?: string; beats?: number }>) {
  const NAMES = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"];
  const ALTER = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
  const measures = bars.map((b, i) => {
    const notes = b.notes
      .map((m) => {
        const pc = m % 12;
        return `<note><pitch><step>${NAMES[pc]}</step>${ALTER[pc] ? "<alter>1</alter>" : ""}<octave>${Math.floor(m / 12) - 1}</octave></pitch><duration>1</duration><voice>1</voice></note>`;
      })
      .join("");
    const attrs =
      i === 0 || b.beats
        ? `<attributes><divisions>1</divisions><time><beats>${b.beats ?? 4}</beats><beat-type>4</beat-type></time></attributes>`
        : "";
    const left = `${b.start ? '<barline location="left"><repeat direction="forward"/></barline>' : ""}${b.ending ? `<barline location="left"><ending number="${b.ending}" type="start"/></barline>` : ""}`;
    const right = `${b.ending ? `<barline location="right"><ending number="${b.ending}" type="stop"/>${b.end ? '<repeat direction="backward"/>' : ""}</barline>` : b.end ? '<barline location="right"><repeat direction="backward"/></barline>' : ""}`;
    return `<measure number="${i + 1}">${attrs}${left}${notes}${right}</measure>`;
  });
  return `<score-partwise><part id="P1">${measures.join("")}</part></score-partwise>`;
}

describe("playThrough", () => {
  it("plays simple repeats twice", () => {
    const bars = parseScore(
      score([
        { notes: [60, 62, 64, 65] },
        { notes: [67, 69, 71, 72], start: true },
        { notes: [72, 71, 69, 67], end: true },
        { notes: [60, 60, 60, 60] },
      ]),
    );
    const order = playThrough(bars).map((p) => `${p.barIndex}.${p.occurrence}`);
    expect(order).toEqual(["0.0", "1.0", "2.0", "1.1", "2.1", "3.0"]);
  });

  it("follows first and second endings", () => {
    const bars = parseScore(
      score([
        { notes: [60, 60, 60, 60], start: true },
        { notes: [62, 62, 62, 62], ending: "1", end: true },
        { notes: [64, 64, 64, 64], ending: "2" },
        { notes: [65, 65, 65, 65] },
      ]),
    );
    expect(playThrough(bars).map((p) => p.barIndex)).toEqual([0, 1, 0, 2, 3]);
  });

  it("dedupes notes duplicated across linked staves and tracks time signatures", () => {
    const bars = parseScore(
      score([
        { notes: [60, 60], beats: 2 },
        { notes: [62, 64, 65, 67, 69, 71], beats: 6 },
      ]),
    );
    expect(bars.map((b) => b.beats)).toEqual([2, 6]);
    expect(bars[0].notes).toEqual([
      { beat: 0, midi: 60 },
      { beat: 1, midi: 60 },
    ]);
  });
});

describe("alignScore", () => {
  it("maps bars (including repeat passes) onto a recording's beats with drifting tempo and a lead-in", () => {
    // Four distinct bars; bars 2–3 repeated. Played order: 0 1 2 1 2 3 (24 beats).
    const xml = score([
      { notes: [60, 64, 67, 64] },
      { notes: [62, 65, 69, 65], start: true },
      { notes: [64, 67, 71, 67], end: true },
      { notes: [65, 69, 72, 69] },
    ]);
    const order = [0, 1, 2, 1, 2, 3];
    const bars = parseScore(xml);
    // Fake recording: 2 s of silence, then each played beat lasts 0.7 s → 0.9 s (slowing down).
    const audio: AudioNote[] = [];
    const barStarts: number[] = [];
    const beatTimes: number[] = [];
    let t = 2;
    let beatIndex = 0;
    for (const b of order) {
      barStarts.push(t);
      for (const note of bars[b].notes) {
        audio.push({ start: t, midi: note.midi, velocity: 0.8 });
        beatTimes.push(t);
        t += 0.7 + (0.2 * beatIndex++) / 24;
      }
    }
    const { syncPoints } = alignScore(xml, audio, beatTimes);
    expect(syncPoints.map((s) => `${s.barIndex}.${s.barOccurence}`)).toEqual([
      "0.0",
      "1.0",
      "2.0",
      "1.1",
      "2.1",
      "3.0",
    ]);
    syncPoints.forEach((s, k) => expect(Math.abs(s.millisecondOffset / 1000 - barStarts[k])).toBeLessThan(0.15));
  });
});

describe("alignScore with a section missing from the score", () => {
  it("skips recorded music the score doesn't have, without shifting the rest", () => {
    // Score: E E A E A E (bars 0–3, bars 2–3 repeated). Recording: E E A E [B B] A E — an extra section.
    const E = [40, 59, 52, 64];
    const A = [45, 61, 52, 61];
    const B = [47, 63, 54, 66];
    const xml = score([{ notes: E }, { notes: E }, { notes: A, start: true }, { notes: E, end: true }]);
    const recorded = [E, E, A, E, B, B, A, E];
    const audio: AudioNote[] = [];
    const beatTimes: number[] = [];
    const barStarts: number[] = [];
    let t = 1;
    for (const bar of recorded) {
      barStarts.push(t);
      for (const midi of bar) {
        audio.push({ start: t, midi, velocity: 0.8 });
        beatTimes.push(t);
        t += 0.78;
      }
    }
    const { syncPoints } = alignScore(xml, audio, beatTimes);
    const expected = [0, 1, 2, 3, 6, 7].map((k) => barStarts[k]); // the B B section is skipped
    syncPoints.forEach((s, k) => expect(s.millisecondOffset / 1000).toBeCloseTo(expected[k], 1));
  });
});
