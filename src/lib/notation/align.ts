/**
 * Align an edited score (MusicXML, e.g. exported from MuseScore) with its
 * recording, producing per-bar sync points for alphaTab.
 *
 * Counting beats isn't enough once a score has been edited: repeats, missing
 * or extra sections and tempo drift all break it. Instead we compare *what is
 * sounding*: a chroma (pitch-class) profile over time for the score, played
 * through with its repeats, and for the notes detected in the recording, then
 * find the best monotonic match with subsequence dynamic time warping. Each
 * played bar's start beat maps to a time in the recording.
 */

import type { SyncPoint } from "./score";

export interface ScoreNote {
  /** Quarter-note beats from the start of the bar. */
  beat: number;
  midi: number;
}

export interface ScoreBar {
  /** Length in quarter-note beats. */
  beats: number;
  notes: ScoreNote[];
  repeatStart: boolean;
  /** Times the section ending here is played (0 = not a repeat end). */
  repeatEnd: number;
  /** Volta numbers this bar belongs to (empty = always played). */
  endings: number[];
}

export interface PlayedBar {
  barIndex: number;
  /** 0 the first time this written bar is played, 1 the second time, … */
  occurrence: number;
  /** Start, in quarter beats along the played-through timeline. */
  start: number;
}

export interface AudioNote {
  start: number; // seconds
  midi: number;
  velocity: number; // 0–1
}

const STEP_ALTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

const tag = (xml: string, name: string) => new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml)?.[1];

/** Parse bars, notes and repeat structure from a single-part MusicXML score. */
export function parseScore(xml: string): ScoreBar[] {
  const part = /<part\b[^>]*>([\s\S]*?)<\/part>/.exec(xml)?.[1];
  if (!part) throw new Error("No <part> in score");
  const bars: ScoreBar[] = [];
  let divisions = 1;
  let barBeats = 4;

  for (const [, body] of part.matchAll(/<measure\b[^>]*>([\s\S]*?)<\/measure>/g)) {
    const div = tag(body, "divisions");
    if (div) divisions = Number(div);
    const beats = /<beats>(\d+)<\/beats>\s*<beat-type>(\d+)<\/beat-type>/.exec(body);
    if (beats) barBeats = (Number(beats[1]) * 4) / Number(beats[2]);

    const notes: ScoreNote[] = [];
    const seen = new Set<string>();
    let cursor = 0; // in divisions
    let lastStart = 0;
    // Walk notes, backups and forwards in document order (voices/staves interleave via <backup>).
    for (const [el, kind, inner] of body.matchAll(/<(note|backup|forward)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
      const duration = Number(tag(inner, "duration") ?? 0);
      if (kind === "backup") {
        cursor -= duration;
        continue;
      }
      if (kind === "forward") {
        cursor += duration;
        continue;
      }
      if (inner.includes("<grace")) continue;
      const isChord = inner.includes("<chord/>");
      const start = isChord ? lastStart : cursor;
      if (!isChord) {
        lastStart = cursor;
        cursor += duration;
      }
      const step = tag(inner, "step");
      if (!step || el.includes("<rest")) continue;
      const midi = 12 * (Number(tag(inner, "octave")) + 1) + STEP_ALTER[step] + Number(tag(inner, "alter") ?? 0);
      const beat = start / divisions;
      const key = `${beat}:${midi}`; // linked notation + tab staves duplicate every note
      if (seen.has(key)) continue;
      seen.add(key);
      notes.push({ beat, midi });
    }

    const endingAttr = /<ending\b[^>]*number="([^"]+)"[^>]*type="start"/.exec(body)?.[1];
    const times = /<repeat\b[^>]*direction="backward"[^>]*?(?:times="(\d+)")?/.exec(body);
    bars.push({
      beats: barBeats,
      notes,
      repeatStart: /<repeat\b[^>]*direction="forward"/.test(body),
      repeatEnd: times ? Number(times[1] ?? 2) : 0,
      endings: endingAttr
        ? endingAttr
            .split(/[,\s]+/)
            .filter(Boolean)
            .map(Number)
        : [],
    });
  }
  // A volta continues until a bar that closes it; carry ending numbers forward until "stop"/"discontinue".
  let open: number[] = [];
  for (const [i, [, body]] of [...part.matchAll(/<measure\b[^>]*>([\s\S]*?)<\/measure>/g)].entries()) {
    if (bars[i].endings.length) open = bars[i].endings;
    else if (open.length) bars[i].endings = open;
    if (/<ending\b[^>]*type="(stop|discontinue)"/.test(body)) open = [];
  }
  return bars;
}

/** Bars in playing order, following simple repeats and first/second-time endings. */
export function playThrough(bars: ScoreBar[]): PlayedBar[] {
  const played: PlayedBar[] = [];
  const occurrences = new Map<number, number>();
  const passes = new Map<number, number>(); // repeat-end bar → passes made
  let sectionStart = 0;
  let pass = 1;
  let beat = 0;
  for (let i = 0; i < bars.length && played.length < bars.length * 8;) {
    const bar = bars[i];
    if (bar.repeatStart && sectionStart !== i) {
      sectionStart = i; // a new repeated section (jumping back lands on the same bar)
      pass = 1;
    }
    if (bar.endings.length && !bar.endings.includes(pass)) {
      i++;
      continue;
    }
    const occurrence = occurrences.get(i) ?? 0;
    occurrences.set(i, occurrence + 1);
    played.push({ barIndex: i, occurrence, start: beat });
    beat += bar.beats;

    if (bar.repeatEnd) {
      const done = (passes.get(i) ?? 0) + 1;
      passes.set(i, done);
      if (done < bar.repeatEnd) {
        pass = done + 1;
        i = sectionStart;
        continue;
      }
      pass = 1;
    }
    i++;
  }
  return played;
}

// ---------- beat-level alignment ----------

const BINS = 24;
/** MIDI notes below this (D3) count as bass. */
const BASS_BELOW = 50;
const BASS_WEIGHT = 1.5;
/** How much of the piece-wide average profile to subtract (open strings ring through everything). */
const DRONE_REMOVAL = 0.5;
/** Extra cost for pairing a beat with nothing (recording music missing from the score, or vice versa). */
const SKIP_PENALTY = 0.35;
/** Cost per recorded beat skipped before the score starts or after it ends. */
const EDGE_PENALTY = 0.2;

type Profile = Float32Array;

/**
 * Pitch profile per beat: 12 pitch classes for the bass (below D3) and 12 for the rest.
 * Keeping the bass separate makes chord changes (E → A in the bass) stand out even when
 * open strings ring the same pitch classes above. The piece-wide average is partly
 * removed so beats are compared on what changes.
 */
function profiles(count: number, events: Array<{ beat: number; midi: number; weight: number }>): Profile[] {
  const out = Array.from({ length: count }, () => new Float32Array(BINS));
  for (const { beat, midi, weight } of events) {
    if (beat < 0 || beat >= count) continue;
    const bass = midi < BASS_BELOW;
    out[beat][(((midi % 12) + 12) % 12) + (bass ? 12 : 0)] += weight * (bass ? BASS_WEIGHT : 1);
  }
  const mean = new Float32Array(BINS);
  let active = 0;
  for (const v of out) {
    const norm = Math.hypot(...v);
    if (!norm) continue;
    active++;
    for (let k = 0; k < BINS; k++) mean[k] += v[k] / norm;
  }
  if (active) for (let k = 0; k < BINS; k++) mean[k] /= active;
  for (const v of out) {
    const norm = Math.hypot(...v);
    if (!norm) continue;
    for (let k = 0; k < BINS; k++) v[k] = Math.max(0, v[k] / norm - DRONE_REMOVAL * mean[k]);
    const centred = Math.hypot(...v);
    if (centred) for (let k = 0; k < BINS; k++) v[k] /= centred;
  }
  return out;
}

function distance(a: Profile, b: Profile): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let k = 0; k < BINS; k++) {
    dot += a[k] * b[k];
    na += a[k];
    nb += b[k];
  }
  if (!na && !nb) return 0.3; // both quiet
  if (!na || !nb) return 1;
  return 1 - dot;
}

/**
 * Pair every score beat with a recorded beat, in order. One-to-one is the default;
 * skipping a beat on either side costs SKIP_PENALTY, and recorded beats skipped
 * before the score starts or after it ends cost EDGE_PENALTY each, so a periodic
 * piece can't slide the whole score along for free.
 * Returns, for each score beat, the matched recorded beat.
 */
function alignBeats(score: Profile[], audio: Profile[]): Int32Array {
  const n = score.length;
  const m = audio.length;
  const cost = new Float64Array((n + 1) * (m + 1)).fill(Infinity);
  const from = new Uint8Array((n + 1) * (m + 1)); // 0 diag, 1 skip score beat, 2 skip recorded beat
  const at = (i: number, j: number) => i * (m + 1) + j;
  for (let j = 0; j <= m; j++) cost[at(0, j)] = j * EDGE_PENALTY;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const c = distance(score[i - 1], audio[j - 1]);
      const diag = cost[at(i - 1, j - 1)] + c;
      const skipScore = cost[at(i - 1, j)] + c + SKIP_PENALTY;
      const skipAudio = cost[at(i, j - 1)] + SKIP_PENALTY;
      if (diag <= skipScore && diag <= skipAudio) {
        cost[at(i, j)] = diag;
        from[at(i, j)] = 0;
      } else if (skipScore <= skipAudio) {
        cost[at(i, j)] = skipScore;
        from[at(i, j)] = 1;
      } else {
        cost[at(i, j)] = skipAudio;
        from[at(i, j)] = 2;
      }
    }
  }
  let j = 1;
  for (let k = 1; k <= m; k++) {
    if (cost[at(n, k)] + (m - k) * EDGE_PENALTY < cost[at(n, j)] + (m - j) * EDGE_PENALTY) j = k;
  }
  const match = new Int32Array(n);
  let i = n;
  while (i > 0 && j > 0) {
    const d = from[at(i, j)];
    if (d === 2) {
      j--;
      continue;
    }
    match[i - 1] = j - 1;
    i--;
    if (d === 0) j--;
  }
  return match;
}

export interface Alignment {
  syncPoints: SyncPoint[];
  playedBars: PlayedBar[];
  playedBeats: number;
}

/**
 * @param beatTimes Times (s) of the recording's beats, from the beat tracker; the score's
 *   quarter-note beats are matched onto these.
 */
export function alignScore(xml: string, audioNotes: AudioNote[], beatTimes: number[]): Alignment {
  const bars = parseScore(xml);
  const playedBars = playThrough(bars);
  const playedBeats = playedBars.reduce((s, p) => s + bars[p.barIndex].beats, 0);

  const scoreProfiles = profiles(
    Math.ceil(playedBeats),
    playedBars.flatMap((p) =>
      bars[p.barIndex].notes.map((note) => ({ beat: Math.floor(p.start + note.beat), midi: note.midi, weight: 1 })),
    ),
  );

  // Which recorded beat each note falls in (a little early counts: plucks lead the beat slightly).
  const beatOf = (t: number) => {
    let lo = 0;
    let hi = beatTimes.length - 1;
    if (t < beatTimes[0] - 0.05) return -1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (beatTimes[mid] <= t + 0.05) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const audioProfiles = profiles(
    beatTimes.length,
    audioNotes.map((note) => ({ beat: beatOf(note.start), midi: note.midi, weight: 0.3 + note.velocity })),
  );

  const match = alignBeats(scoreProfiles, audioProfiles);
  const syncPoints = playedBars.map((p) => ({
    barIndex: p.barIndex,
    barPosition: 0,
    barOccurence: p.occurrence,
    millisecondOffset: Math.round(beatTimes[match[Math.min(match.length - 1, Math.round(p.start))]] * 1000),
  }));
  return { syncPoints, playedBars, playedBeats };
}
