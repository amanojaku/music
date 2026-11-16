/**
 * Rebuild a track's sync points for an edited score (e.g. exported from MuseScore),
 * by aligning the score with the notes detected in the recording.
 *
 *   npm run sync -- <slug> <score.musicxml>
 *
 * Uses public/notation/<slug>/raw.mid (written by `npm run transcribe`) as the
 * recording's notes, writes public/notation/<slug>/sync.json, and prints a
 * summary with any bars whose timing looks suspicious.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Midi } from "@tonejs/midi";
import { alignScore, type AudioNote } from "../src/lib/notation/align";
import { estimateTempo, extendBeats, onsetEnvelope, trackBeats } from "../src/lib/notation/beats";

function main() {
  const [slug, scorePath] = process.argv.slice(2);
  if (!slug || !scorePath) {
    console.error("Usage: npm run sync -- <slug> <score.musicxml>");
    process.exit(1);
  }
  const dir = path.join(process.cwd(), "public/notation", slug);
  const midi = new Midi(readFileSync(path.join(dir, "raw.mid")));
  const notes: AudioNote[] = midi.tracks.flatMap((t) =>
    t.notes.map((n) => ({ start: n.time, midi: n.midi, velocity: n.velocity })),
  );
  const seconds = Math.max(...notes.map((n) => n.start)) + 3;

  // The recording's beats, from the same tracker the transcription used (it follows tempo drift).
  const detected = notes.map((n) => ({ start: n.start, duration: 0, pitch: n.midi, amplitude: n.velocity }));
  const env = onsetEnvelope(detected, seconds);
  const bpm = estimateTempo(env);
  const first = Math.min(...notes.map((n) => n.start));
  const beatTimes = extendBeats(trackBeats(env, bpm), first, seconds, bpm);

  const { syncPoints, playedBars, playedBeats } = alignScore(readFileSync(scorePath, "utf8"), notes, beatTimes);
  const out = path.join(dir, "sync.json");
  writeFileSync(out, JSON.stringify(syncPoints, null, 2) + "\n");

  // Summary: bar lengths in the recording, flagging outliers.
  const lengths = syncPoints.slice(1).map((s, k) => (s.millisecondOffset - syncPoints[k].millisecondOffset) / 1000);
  const sorted = [...lengths].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const odd = lengths
    .map((len, k) => ({ len, k }))
    .filter(({ len }) => len < median * 0.4 || len > median * 2.5)
    .map(
      ({ len, k }) =>
        `bar ${playedBars[k].barIndex + 1}${playedBars[k].occurrence ? ` (pass ${playedBars[k].occurrence + 1})` : ""}: ${len.toFixed(1)}s`,
    );

  console.log(
    `${playedBars.length} played bars (${playedBeats} beats, repeats followed); recording has ${beatTimes.length} beats at ≈${bpm.toFixed(1)} BPM`,
  );
  console.log(
    `first bar at ${(syncPoints[0].millisecondOffset / 1000).toFixed(2)}s, last bar at ${(syncPoints[syncPoints.length - 1].millisecondOffset / 1000).toFixed(1)}s, typical bar ${median.toFixed(2)}s`,
  );
  if (odd.length) console.log(`check: ${odd.join(", ")}`);
  console.log(`Wrote ${path.relative(process.cwd(), out)}`);
}

main();
