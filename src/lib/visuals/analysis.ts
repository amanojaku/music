/**
 * Real-time analysis of an <audio> element via the Web Audio API.
 *
 * Produces, per animation frame:
 *  - six log-spaced frequency bands across the acoustic guitar's range
 *    (≈80 Hz – 5 kHz), each normalised against its own recent peak so quiet
 *    recordings still move the visuals;
 *  - overall level (RMS);
 *  - onset strength when a new note is plucked (spectral flux).
 *
 * The audio element is routed through an AudioContext the first time
 * `resume()` is called, which must happen inside a user gesture (e.g. Play).
 * Cross-origin audio (Supabase Storage) needs `crossOrigin="anonymous"` on the
 * element and CORS headers on the bucket, or the analyser reads silence.
 */

export const BAND_COUNT = 6;
const BAND_EDGES_HZ = [80, 160, 320, 640, 1280, 2560, 5120];

export interface AudioFrame {
  /** 0–1 per band, low → high. */
  bands: Float32Array;
  /** 0–1 overall loudness. */
  level: number;
  /** 0–1 strength of a note onset this frame; 0 when none. */
  onset: number;
}

export function silentFrame(): AudioFrame {
  return { bands: new Float32Array(BAND_COUNT), level: 0, onset: 0 };
}

export class AudioAnalysis {
  readonly frame: AudioFrame = silentFrame();
  /** Total onsets detected (diagnostics). */
  onsetCount = 0;

  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private freq = new Uint8Array(0);
  private prevFreq = new Float32Array(0);
  private wave = new Uint8Array(0);
  private bandBins: Array<[number, number]> = [];
  private bandPeak = new Float32Array(BAND_COUNT).fill(0.15);
  private levelPeak = 0.05;
  private fluxHistory: number[] = [];
  private lastOnsetAt = 0;

  constructor(private readonly element: HTMLAudioElement) {}

  /** Connect (first call) and resume the audio context. Call from a user gesture. */
  async resume(): Promise<void> {
    if (!this.ctx) this.connect();
    if (this.ctx?.state === "suspended") await this.ctx.resume();
  }

  private connect() {
    const ctx = new AudioContext();
    const source = ctx.createMediaElementSource(this.element);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.55;
    source.connect(analyser);
    analyser.connect(ctx.destination);

    const binHz = ctx.sampleRate / analyser.fftSize;
    this.bandBins = BAND_EDGES_HZ.slice(0, -1).map((lo, i) => [
      Math.max(1, Math.floor(lo / binHz)),
      Math.max(2, Math.ceil(BAND_EDGES_HZ[i + 1] / binHz)),
    ]);
    this.freq = new Uint8Array(analyser.frequencyBinCount);
    this.prevFreq = new Float32Array(analyser.frequencyBinCount);
    this.wave = new Uint8Array(analyser.fftSize);
    this.ctx = ctx;
    this.analyser = analyser;

    // Diagnostics: add ?debug-visuals to the URL to inspect `window.__analysis`.
    if (new URLSearchParams(window.location.search).has("debug-visuals")) {
      (window as unknown as { __analysis?: AudioAnalysis }).__analysis = this;
    }
  }

  /** Read the analyser and update `frame`. `now` is a rAF timestamp in ms. */
  update(now: number): AudioFrame {
    const frame = this.frame;
    const analyser = this.analyser;
    if (!analyser) return frame;

    analyser.getByteFrequencyData(this.freq);
    analyser.getByteTimeDomainData(this.wave);

    // Bands, each normalised against a slowly decaying peak.
    let flux = 0;
    this.bandBins.forEach(([lo, hi], b) => {
      let sum = 0;
      for (let i = lo; i < hi; i++) {
        const v = this.freq[i] / 255;
        sum += v;
        const rise = v - this.prevFreq[i];
        if (rise > 0) flux += rise;
        this.prevFreq[i] = v;
      }
      const avg = sum / (hi - lo);
      this.bandPeak[b] = Math.max(avg, this.bandPeak[b] * 0.9985, 0.08);
      frame.bands[b] = Math.min(1, avg / this.bandPeak[b]);
    });

    // Level (RMS of the waveform), normalised the same way.
    let sq = 0;
    for (let i = 0; i < this.wave.length; i++) {
      const s = (this.wave[i] - 128) / 128;
      sq += s * s;
    }
    const rms = Math.sqrt(sq / this.wave.length);
    this.levelPeak = Math.max(rms, this.levelPeak * 0.999, 0.02);
    frame.level = Math.min(1, rms / this.levelPeak);

    // Onsets: spectral flux above an adaptive threshold, with a short refractory period.
    const history = this.fluxHistory;
    const mean = history.length ? history.reduce((a, b) => a + b, 0) / history.length : 0;
    history.push(flux);
    if (history.length > 40) history.shift();
    const threshold = mean * 1.5 + 0.4;
    if (flux > threshold && now - this.lastOnsetAt > 90 && rms > 0.005) {
      frame.onset = Math.min(1, (flux - mean) / (threshold * 2));
      this.lastOnsetAt = now;
      this.onsetCount++;
    } else {
      frame.onset = 0;
    }
    return frame;
  }
}
