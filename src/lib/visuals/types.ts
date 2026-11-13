import type { Palette } from "@/lib/colour";
import type { AudioFrame } from "./analysis";

export interface Scene {
  ctx: CanvasRenderingContext2D;
  /** CSS pixels (the context is already scaled for devicePixelRatio). */
  width: number;
  height: number;
  /** Centre of the playing disc, in canvas CSS pixels. */
  origin: { x: number; y: number; radius: number };
  palette: Palette;
  dark: boolean;
  /** Small/touch screens: styles should draw less. */
  lite: boolean;
}

export interface VisualStyle {
  /** Draw one frame. `dt` is seconds since the last frame (clamped), `t` total seconds. */
  draw(scene: Scene, frame: AudioFrame, dt: number, t: number): void;
  /** True while anything is still moving, so the loop can stop once settled. */
  isActive(): boolean;
}

export interface StyleDefinition {
  id: string;
  label: string;
  create(): VisualStyle;
}

/** hsl() string for a hue, adjusted for theme and key mode. */
export function colour(palette: Palette, hue: number, alpha: number, dark: boolean, lift = 0): string {
  const sat = palette.minor ? 45 : 72;
  const light = (dark ? 64 : 42) + lift;
  const h = palette.minor ? (hue + 340) % 360 : hue; // minor: nudge cooler
  return `hsl(${h} ${sat}% ${light}% / ${Math.max(0, Math.min(1, alpha))})`;
}

/** Fast attack, exponential release: smooths a value towards a target. */
export function envelope(current: number, target: number, dt: number, attack = 0.5, releasePerSec = 3): number {
  return target > current ? current + (target - current) * attack : current * Math.exp(-releasePerSec * dt);
}
