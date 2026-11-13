/**
 * Transcribe a recording into a draft score for the notation view.
 *
 *   npm run transcribe -- <slug> <recording.wav> [--bpm 84] [--beats 4] [--shift 1] [--backend wasm|cpu]
 *
 * Reads the track's title, key and tuning from the track data (mock or
 * src/data/local-tracks.json), then writes to public/notation/<slug>/:
 *   score.musicxml  draft notation + tab; open in MuseScore to tidy, then export MusicXML over it
 *   sync.json       per-bar times in the recording, so the cursor follows the audio
 *   raw.mid         unquantised notes straight from Basic Pitch
 *
 * Notes come from Spotify's Basic Pitch (Apache-2.0), run locally on the CPU.
 * Input must be a PCM or float WAV (any sample rate / channel count).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as tf from "@tensorflow/tfjs";
import { setWasmPaths } from "@tensorflow/tfjs-backend-wasm";
import {
  addPitchBendsToNoteEvents,
  BasicPitch,
  noteFramesToTime,
  outputToNotesPoly,
} from "@spotify/basic-pitch";
import { generateFileData } from "@spotify/basic-pitch/esm/toMidi.js";
import { mockTracks } from "../src/data/mock-tracks";
import { STANDARD_TUNING, noteToMidi } from "../src/lib/music-theory";
import type { DetectedNote } from "../src/lib/notation/beats";
import { buildTranscription } from "../src/lib/notation/score";
import type { Track } from "../src/types/track";

const MODEL_SAMPLE_RATE = 22050;

// ---------- args ----------

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) flags[argv[i].slice(2)] = argv[++i];
    else positional.push(argv[i]);
  }
  const [slug, wav] = positional;
  if (!slug || !wav) {
    console.error(
      "Usage: npm run transcribe -- <slug> <recording.wav> [--bpm 84] [--beats 4] [--shift 1] [--backend wasm|cpu]",
    );
    process.exit(1);
  }
  const num = (k: string) => (flags[k] !== undefined ? Number(flags[k]) : undefined);
  return {
    slug,
    wav,
    bpm: num("bpm"),
    beatsPerBar: num("beats"),
    shiftBeats: num("shift"),
    backend: flags.backend ?? "wasm",
  };
}

function findTrack(slug: string): Track {
  let local: Track[] = [];
  try {
    local = JSON.parse(readFileSync("src/data/local-tracks.json", "utf8"));
  } catch {
    // no local tracks
  }
  const track = [...mockTracks, ...local].find((t) => t.slug === slug);
  if (!track) throw new Error(`No track with slug "${slug}"`);
  if (!track.keyTonic || !track.keyMode) throw new Error(`Track "${slug}" needs keyTonic and keyMode`);
  return track;
}

// ---------- audio ----------

/** Decode a RIFF WAV (PCM 8/16/24/32-bit or float32) to mono Float32. */
function decodeWav(buf: Buffer): { samples: Float32Array; sampleRate: number } {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error("Not a WAV file");
  let offset = 12;
  let format = 0;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      format = buf.readUInt16LE(body);
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
      if (format === 0xfffe) format = buf.readUInt16LE(body + 24); // WAVE_FORMAT_EXTENSIBLE sub-format
    } else if (id === "data") {
      const bytes = bits / 8;
      const frames = Math.floor(Math.min(size, buf.length - body) / (bytes * channels));
      const samples = new Float32Array(frames);
      for (let f = 0; f < frames; f++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) {
          const p = body + (f * channels + c) * bytes;
          if (format === 3) sum += buf.readFloatLE(p);
          else if (bits === 16) sum += buf.readInt16LE(p) / 32768;
          else if (bits === 24) sum += buf.readIntLE(p, 3) / 8388608;
          else if (bits === 32) sum += buf.readInt32LE(p) / 2147483648;
          else if (bits === 8) sum += (buf.readUInt8(p) - 128) / 128;
        }
        samples[f] = sum / channels;
      }
      return { samples, sampleRate };
    }
    offset = body + size + (size % 2);
  }
  throw new Error("WAV has no data chunk");
}

/** Resample with a windowed-sinc low-pass (good enough for note detection). */
function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  const cutoff = Math.min(1, to / from) * 0.95;
  const half = 16;
  for (let i = 0; i < out.length; i++) {
    const centre = i * ratio;
    const lo = Math.ceil(centre - half);
    let sum = 0;
    let norm = 0;
    for (let j = lo; j <= centre + half; j++) {
      if (j < 0 || j >= input.length) continue;
      const x = j - centre;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * cutoff * x) / (Math.PI * cutoff * x);
      const w = 0.5 + 0.5 * Math.cos((Math.PI * x) / (half + 1));
      sum += input[j] * sinc * w;
      norm += sinc * w;
    }
    out[i] = norm ? sum / norm : 0;
  }
  return out;
}

// ---------- model ----------

async function loadModel(): Promise<tf.GraphModel> {
  const dir = path.join(process.cwd(), "node_modules/@spotify/basic-pitch/model");
  const json = JSON.parse(readFileSync(path.join(dir, "model.json"), "utf8"));
  const weightSpecs = json.weightsManifest.flatMap((g: { weights: unknown[] }) => g.weights);
  const buffers = json.weightsManifest.flatMap((g: { paths: string[] }) =>
    g.paths.map((p) => readFileSync(path.join(dir, p))),
  );
  const all = Buffer.concat(buffers);
  const weightData = all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength);
  return tf.loadGraphModel(
    tf.io.fromMemory({ modelTopology: json.modelTopology, format: json.format, weightSpecs, weightData }),
  );
}

/**
 * tfjs 3.21's tf.signal.frame calls fill() without a dtype; the CPU kernel infers
 * one but the WASM kernel throws. Default it to float32.
 */
function patchWasmFill() {
  const kernel = tf.getKernel("Fill", "wasm");
  if (!kernel) return;
  tf.unregisterKernel("Fill", "wasm");
  tf.registerKernel({
    ...kernel,
    kernelFunc: (args) =>
      kernel.kernelFunc({ ...args, attrs: { ...args.attrs, dtype: args.attrs?.dtype ?? "float32" } }),
  });
}

// ---------- main ----------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const track = findTrack(args.slug);
  const tuning = track.tuning ?? STANDARD_TUNING;
  const key = { tonic: track.keyTonic!, mode: track.keyMode! };

  console.log(`Transcribing "${track.title}" (${key.tonic} ${key.mode}, tuning ${tuning.join(" ")})`);
  const { samples, sampleRate } = decodeWav(readFileSync(args.wav));
  const duration = samples.length / sampleRate;
  console.log(`  audio: ${duration.toFixed(1)}s at ${sampleRate} Hz → resampling to ${MODEL_SAMPLE_RATE} Hz`);
  const audio = resample(samples, sampleRate, MODEL_SAMPLE_RATE);

  // WebAssembly (SIMD) is many times faster than the pure-JS CPU backend.
  if (args.backend === "wasm") {
    setWasmPaths(path.join(process.cwd(), "node_modules/@tensorflow/tfjs-backend-wasm/dist") + path.sep);
    patchWasmFill();
  }
  if (!(await tf.setBackend(args.backend))) throw new Error(`TensorFlow backend "${args.backend}" unavailable`);
  await tf.ready();
  console.log(`  backend: ${tf.getBackend()}`);
  const basicPitch = new BasicPitch(loadModel());
  const frames: number[][] = [];
  const onsets: number[][] = [];
  const contours: number[][] = [];
  const started = Date.now();
  let lastPct = -10;
  await basicPitch.evaluateModel(
    audio,
    (f, o, c) => {
      frames.push(...f);
      onsets.push(...o);
      contours.push(...c);
    },
    (p) => {
      const pct = Math.floor(p * 100);
      if (pct >= lastPct + 10) {
        process.stdout.write(`  detecting notes… ${pct}%\r`);
        lastPct = pct;
      }
    },
  );
  console.log(`  detecting notes… done in ${((Date.now() - started) / 1000).toFixed(0)}s`);

  // Limit to the guitar's range in this tuning (open low string … 20th fret on the high string).
  const midi = tuning.map(noteToMidi);
  const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);
  const events = noteFramesToTime(
    addPitchBendsToNoteEvents(
      contours,
      outputToNotesPoly(frames, onsets, 0.5, 0.3, 11, true, hz(Math.max(...midi) + 20), hz(Math.min(...midi) - 1)),
    ),
  );
  const notes: DetectedNote[] = events.map((n) => ({
    start: n.startTimeSeconds,
    duration: n.durationSeconds,
    pitch: n.pitchMidi,
    amplitude: n.amplitude,
  }));
  console.log(`  ${notes.length} notes detected`);

  const result = buildTranscription(notes, {
    title: track.title,
    key,
    tuning,
    duration,
    bpm: args.bpm,
    beatsPerBar: args.beatsPerBar,
    shiftBeats: args.shiftBeats,
  });

  const outDir = path.join(process.cwd(), "public/notation", track.slug);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "score.musicxml"), result.musicXml);
  writeFileSync(path.join(outDir, "sync.json"), JSON.stringify(result.syncPoints, null, 2) + "\n");
  writeFileSync(path.join(outDir, "raw.mid"), generateFileData(events));

  console.log(
    `  tempo ≈ ${result.bpm.toFixed(1)} BPM, ${result.bars} bars, ${result.events} note events` +
      (result.dropped ? `, ${result.dropped} notes outside the guitar's range dropped` : ""),
  );
  console.log(`Wrote ${path.relative(process.cwd(), outDir)}/{score.musicxml,sync.json,raw.mid}`);
}

main().catch((err) => {
  console.error(process.env.DEBUG ? err : err instanceof Error ? err.message : err);
  process.exit(1);
});
