// Generates short placeholder WAV tones in public/music for the mock tracks.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const outDir = path.join(process.cwd(), "public", "music");
mkdirSync(outDir, { recursive: true });

const samples = [
  { name: "first-light", freqs: [261.63, 329.63, 392.0] },
  { name: "night-drive", freqs: [220.0, 277.18, 329.63] },
  { name: "low-tide", freqs: [196.0, 246.94, 293.66] },
  { name: "glass-houses", freqs: [293.66, 369.99, 440.0] },
  { name: "copper-sky", freqs: [164.81, 207.65, 246.94] },
  { name: "paper-boats", freqs: [349.23, 440.0, 523.25] },
];

const rate = 22050;
const seconds = 4;

for (const { name, freqs } of samples) {
  const n = rate * seconds;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const env = Math.min(1, t * 4) * Math.min(1, (seconds - t) * 2);
    const v = freqs.reduce((s, f) => s + Math.sin(2 * Math.PI * f * t), 0) / freqs.length;
    buf.writeInt16LE(Math.round(v * env * 0.4 * 32767), 44 + i * 2);
  }
  writeFileSync(path.join(outDir, `${name}.wav`), buf);
  console.log(`wrote public/music/${name}.wav`);
}
