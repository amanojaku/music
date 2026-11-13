/**
 * Generates fingerpicked-guitar test audio for each mock track, in the track's key.
 *
 * Karplus–Strong plucked strings playing a Travis-style pattern (alternating
 * thumb bass on the beat, fingers on the off-beats) over a four-chord
 * progression, with slight tempo drift and timing jitter to mimic a player
 * without a click. Output: public/music/mock/<slug>.wav
 *
 * Pass --if-missing to skip tracks whose file already exists (used by predev).
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { mockTracks } from "../src/data/mock-tracks";
import { diatonicTriads, pitchClass, type Key } from "../src/lib/music-theory";

const RATE = 44100;
const BPM = 84;
const BARS_PER_CHORD = 2;
const TAIL_SECONDS = 2.5;
const PROGRESSIONS: Record<Key["mode"], number[]> = {
  major: [1, 6, 4, 5], // I–vi–IV–V
  minor: [1, 6, 3, 7], // i–VI–III–VII
};

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const midiToFreq = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** Lowest MIDI note with pitch class `pc` that is >= `floor`. */
const atOrAbove = (pc: number, floor: number) => floor + ((((pc - floor) % 12) + 12) % 12);

function pluck(out: Float32Array, startSec: number, midi: number, velocity: number, rand: () => number) {
  const start = Math.round(startSec * RATE);
  const period = Math.max(2, Math.round(RATE / midiToFreq(midi)));
  const buf = new Float32Array(period);
  // Excitation: low-passed noise; softer plucks are darker.
  let lp = 0;
  const brightness = 0.35 + velocity * 0.4;
  for (let i = 0; i < period; i++) {
    lp += brightness * (rand() * 2 - 1 - lp);
    buf[i] = lp * velocity;
  }
  const length = Math.min(out.length - start, Math.round(3 * RATE));
  let idx = 0;
  for (let n = 0; n < length; n++) {
    const next = (idx + 1) % period;
    const v = buf[idx];
    out[start + n] += v;
    buf[idx] = 0.5 * (v + buf[next]) * 0.9985;
    idx = next;
  }
}

function render(key: Key, seed: number): Float32Array {
  const rand = mulberry32(seed);
  const chords = diatonicTriads(key);
  const progression = PROGRESSIONS[key.mode].map((degree) => chords[degree - 1]);
  const eighth = 60 / BPM / 2;
  const totalEighths = progression.length * BARS_PER_CHORD * 8;
  const out = new Float32Array(Math.ceil((totalEighths * eighth * 1.03 + TAIL_SECONDS) * RATE));

  let t = 0.25;
  let step = 0;
  for (const chord of progression) {
    const [root, third, fifth] = chord.notes.map(pitchClass);
    const bassRoot = atOrAbove(root, 40); // E2 and up
    const bassFifth = bassRoot - 5 >= 40 ? bassRoot - 5 : bassRoot + 7;
    const u0 = atOrAbove(third, 55); // upper voices from G3
    const u1 = atOrAbove(fifth, u0 + 1);
    const u2 = atOrAbove(root, u1 + 1);
    const pattern = [bassRoot, u0, bassFifth, u1, bassRoot, u2, bassFifth, u1];

    for (let bar = 0; bar < BARS_PER_CHORD; bar++) {
      for (let i = 0; i < 8; i++) {
        const isBass = i % 2 === 0;
        const velocity = isBass ? 0.85 + rand() * 0.1 : 0.5 + rand() * 0.2;
        const jitter = (rand() - 0.5) * 0.016;
        pluck(out, t + jitter, pattern[i], velocity, rand);
        // "Somewhat steady" tempo: slow ±2.5% drift.
        t += eighth * (1 + 0.025 * Math.sin((2 * Math.PI * step) / 48));
        step++;
      }
    }
  }

  // Gentle low-pass for a warmer body, then normalise.
  let y = 0;
  let peak = 0;
  for (let i = 0; i < out.length; i++) {
    y += 0.45 * (out[i] - y);
    out[i] = y;
    peak = Math.max(peak, Math.abs(y));
  }
  const gain = 0.8 / (peak || 1);
  for (let i = 0; i < out.length; i++) out[i] *= gain;
  return out;
}

function wav(samples: Float32Array): Buffer {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((s, i) => buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), 44 + i * 2));
  return buf;
}

const publicDir = path.join(process.cwd(), "public");
const ifMissing = process.argv.includes("--if-missing");
for (const [i, track] of mockTracks.entries()) {
  if (!track.keyTonic || !track.keyMode) continue;
  const file = path.join(publicDir, track.audioPath);
  if (ifMissing && existsSync(file)) continue;
  const samples = render({ tonic: track.keyTonic, mode: track.keyMode }, 1000 + i);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, wav(samples));
  console.log(`wrote ${path.relative(process.cwd(), file)} (${(samples.length / RATE).toFixed(1)}s)`);
}
