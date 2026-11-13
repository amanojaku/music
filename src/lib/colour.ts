import type { Track } from "@/types/track";

/** Stable hue per track so each disc label (and its visuals) gets its own colour. */
export function hueFor(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  // Golden-angle spread keeps neighbouring tracks visually distinct.
  return Math.round((h * 137.508) % 360);
}

export interface Palette {
  /** Primary hue (the disc label colour). */
  hue: number;
  /** Secondary hue, 40° round the wheel (the label gradient's second colour). */
  hue2: number;
  /** Minor keys get a cooler, softer treatment. */
  minor: boolean;
}

export function paletteFor(track: Pick<Track, "slug" | "keyMode">): Palette {
  const hue = hueFor(track.slug);
  return { hue, hue2: (hue + 40) % 360, minor: track.keyMode === "minor" };
}
