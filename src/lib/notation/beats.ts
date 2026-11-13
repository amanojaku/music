/**
 * Tempo estimation and beat tracking from detected notes.
 *
 * Recordings made without a click drift in tempo, so a single BPM can't place
 * barlines. Instead: build an onset-strength envelope from the notes, estimate
 * the overall tempo by autocorrelation, then find the best sequence of beats
 * with dynamic programming (Ellis, "Beat Tracking by Dynamic Programming",
 * 2007), which lets the beat period flex locally while staying near the tempo.
 */

export interface DetectedNote {
  /** Seconds. */
  start: number;
  /** Seconds. */
  duration: number;
  /** MIDI note number. */
  pitch: number;
  /** 0–1. */
  amplitude: number;
}

/** Envelope frame rate (frames per second). */
const FPS = 100;

/** Pitches below this (D3) count as bass notes, which usually fall on the beat in fingerpicking. */
const BASS_PITCH = 50;

function gaussianSmooth(input: Float32Array, sigma: number): Float32Array {
  const radius = Math.ceil(sigma * 3);
  const kernel = Array.from({ length: radius * 2 + 1 }, (_, i) => Math.exp(-0.5 * ((i - radius) / sigma) ** 2));
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) {
    if (!input[i]) continue;
    for (let k = -radius; k <= radius; k++) {
      const j = i + k;
      if (j >= 0 && j < out.length) out[j] += input[i] * kernel[k + radius];
    }
  }
  return out;
}

/** Onset strength over time, sampled at FPS. Bass notes weigh more. */
export function onsetEnvelope(notes: DetectedNote[], totalSeconds: number): Float32Array {
  const env = new Float32Array(Math.ceil(totalSeconds * FPS) + 1);
  for (const note of notes) {
    const i = Math.round(note.start * FPS);
    if (i >= 0 && i < env.length) env[i] += note.amplitude * (note.pitch < BASS_PITCH ? 1.5 : 1);
  }
  return gaussianSmooth(env, 2);
}

/**
 * Overall tempo in BPM from the envelope's autocorrelation, searched within
 * [minBpm, maxBpm] and gently weighted towards ~100 BPM to resolve
 * half/double-time ambiguity.
 */
export function estimateTempo(env: Float32Array, minBpm = 60, maxBpm = 140): number {
  const minLag = Math.floor((60 * FPS) / maxBpm);
  const maxLag = Math.ceil((60 * FPS) / minBpm);
  const scores = new Float64Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag + 1; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < env.length; i++) sum += env[i] * env[i + lag];
    const bpm = (60 * FPS) / lag;
    scores[lag] = sum * Math.exp(-0.5 * (Math.log2(bpm / 100) / 0.9) ** 2);
  }
  let best = minLag;
  for (let lag = minLag; lag <= maxLag; lag++) if (scores[lag] > scores[best]) best = lag;
  // Parabolic interpolation for sub-frame accuracy.
  const [a, b, c] = [scores[best - 1] ?? 0, scores[best], scores[best + 1] ?? 0];
  const denom = a - 2 * b + c;
  const refined = denom ? best + (0.5 * (a - c)) / denom : best;
  return (60 * FPS) / refined;
}

/** Beat times in seconds, by dynamic programming over the onset envelope. */
export function trackBeats(env: Float32Array, bpm: number, tightness = 100): number[] {
  const period = (60 * FPS) / bpm;
  const n = env.length;
  if (n === 0) return [];

  let mean = 0;
  for (const v of env) mean += v;
  mean /= n;
  let variance = 0;
  for (const v of env) variance += (v - mean) ** 2;
  const std = Math.sqrt(variance / n) || 1;

  const score = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  const minGap = Math.round(period / 2);
  const maxGap = Math.round(period * 2);

  for (let t = 0; t < n; t++) {
    let best = -Infinity;
    let arg = -1;
    for (let p = t - maxGap; p <= t - minGap; p++) {
      if (p < 0) continue;
      const s = score[p] - tightness * Math.log((t - p) / period) ** 2;
      if (s > best) {
        best = s;
        arg = p;
      }
    }
    // A beat may also start a fresh sequence (no predecessor), so the first
    // real beat isn't penalised for having nothing before it.
    const chained = arg >= 0 && best > 0;
    score[t] = env[t] / std + (chained ? best : 0);
    back[t] = chained ? arg : -1;
  }

  // Best final beat within the last period, then trace back.
  let end = n - 1;
  for (let t = Math.max(0, n - Math.round(period)); t < n; t++) if (score[t] > score[end]) end = t;
  const frames: number[] = [];
  for (let t = end; t >= 0; t = back[t]) frames.push(t);
  return frames.reverse().map((f) => f / FPS);
}

/**
 * Pad beats at the local period so they cover [from, to]. A beat up to a
 * quarter-period after `from` already covers it (onsets jitter slightly).
 */
export function extendBeats(beats: number[], from: number, to: number, bpm: number): number[] {
  const fallback = 60 / bpm;
  const out = beats.length ? [...beats] : [from];
  const headPeriod = out.length > 1 ? out[1] - out[0] : fallback;
  while (out[0] > from + headPeriod / 4) out.unshift(out[0] - headPeriod);
  const tailPeriod = out.length > 1 ? out[out.length - 1] - out[out.length - 2] : fallback;
  while (out[out.length - 1] < to) out.push(out[out.length - 1] + tailPeriod);
  return out;
}

/**
 * Which beat (0 … beatsPerBar-1) is most likely the first downbeat, judged by
 * where the strong bass notes land.
 */
export function chooseDownbeat(beats: number[], notes: DetectedNote[], beatsPerBar: number): number {
  const weights = beats.map((b) => {
    let w = 0;
    for (const note of notes) {
      if (Math.abs(note.start - b) < 0.06) w += note.amplitude * (note.pitch < BASS_PITCH ? 2 : 0.5);
    }
    return w;
  });
  let best = 0;
  let bestScore = -1;
  for (let offset = 0; offset < beatsPerBar; offset++) {
    let s = 0;
    for (let i = offset; i < weights.length; i += beatsPerBar) s += weights[i];
    if (s > bestScore) {
      bestScore = s;
      best = offset;
    }
  }
  return best;
}
