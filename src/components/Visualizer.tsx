"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { Palette } from "@/lib/colour";
import { useMediaQuery } from "@/lib/hooks";
import { BAND_COUNT, silentFrame, type AudioAnalysis, type AudioFrame } from "@/lib/visuals/analysis";
import { VISUAL_STYLES, type VisualStyleId } from "@/lib/visuals/styles";
import type { Scene, VisualStyle } from "@/lib/visuals/types";

type Origin = Scene["origin"];

type Props = {
  analysisRef: RefObject<AudioAnalysis | null>;
  styleId: VisualStyleId;
  palette: Palette;
  playing: boolean;
  /** Centre and radius of the playing disc, in viewport coordinates. */
  getOrigin: () => Origin | null;
};

const SILENT = silentFrame();

/** A still, mid-level frame for visitors who prefer reduced motion. */
const STILL: AudioFrame = { bands: new Float32Array(BAND_COUNT).fill(0.45), level: 0.45, onset: 0 };

/**
 * Full-viewport canvas behind the page that draws the selected visual style,
 * driven by live audio analysis. The loop only runs while music plays or the
 * style is still settling, and pauses when the tab is hidden.
 */
export function Visualizer({ analysisRef, styleId, palette, playing, getOrigin }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const styleRef = useRef<{ id: VisualStyleId; style: VisualStyle } | null>(null);
  const dark = useMediaQuery("(prefers-color-scheme: dark)");
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const lite = useMediaQuery("(max-width: 640px), (pointer: coarse)");

  // Latest values for the loop, without restarting it on every render.
  const live = useRef({ palette, dark, lite, getOrigin });
  useEffect(() => {
    live.current = { palette, dark, lite, getOrigin };
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const definition = VISUAL_STYLES.find((s) => s.id === styleId);
    if (!definition) {
      styleRef.current = null;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    if (styleRef.current?.id !== styleId) {
      styleRef.current = { id: styleId, style: definition.create() };
    }
    const style = styleRef.current.style;

    let width = 0;
    let height = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, live.current.lite ? 1 : 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const scene = (): Scene => {
      const { palette, dark, lite, getOrigin } = live.current;
      const origin = getOrigin() ?? { x: width / 2, y: height / 3, radius: 120 };
      return { ctx, width, height, origin, palette, dark, lite };
    };

    let raf = 0;
    let last = 0;
    const start = performance.now();

    const tick = (now: number) => {
      raf = 0;
      // Phones: cap at ~30 fps.
      if (live.current.lite && last && now - last < 1000 / 30 - 2) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      const frame = analysisRef.current?.update(now) ?? SILENT;
      style.draw(scene(), frame, dt, (now - start) / 1000);
      if (playing || style.isActive()) raf = requestAnimationFrame(tick);
    };

    const startLoop = () => {
      if (!raf && !document.hidden) {
        last = 0;
        raf = requestAnimationFrame(tick);
      }
    };
    const stopLoop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };

    const drawStill = () => {
      ctx.clearRect(0, 0, width, height);
      for (let i = 0; i < 30; i++) style.draw(scene(), STILL, 1 / 60, 0);
    };

    const onResize = () => {
      resize();
      if (reducedMotion) drawStill();
    };
    const onVisibility = () => (document.hidden ? stopLoop() : startLoop());

    resize();
    window.addEventListener("resize", onResize);
    if (reducedMotion) {
      if (playing) drawStill();
      else ctx.clearRect(0, 0, width, height);
    } else {
      document.addEventListener("visibilitychange", onVisibility);
      startLoop();
    }

    return () => {
      stopLoop();
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [styleId, playing, reducedMotion, analysisRef]);

  return <canvas ref={canvasRef} aria-hidden className="pointer-events-none fixed inset-0 -z-10 h-full w-full" />;
}
