"use client";

import { useRef, type ReactNode } from "react";
import { Disc } from "@/components/Disc";
import { usePlayer } from "@/components/PlayerContext";
import { StylePicker } from "@/components/StylePicker";
import { Visualizer } from "@/components/Visualizer";
import { paletteFor } from "@/lib/colour";
import { formatDuration } from "@/lib/format";
import { useVisualStyle } from "@/lib/hooks";

/**
 * Track page player UI: a clickable spinning disc, transport controls, and the
 * live visuals drawn behind the page, centred on the disc. Must be inside
 * <PlayerProvider>.
 */
export function TrackPlayer({ children }: { children?: ReactNode }) {
  const { track, analysisRef, isPlaying, hasStarted, currentTime, duration, toggle, seek } = usePlayer();
  const discRef = useRef<HTMLButtonElement>(null);
  const [visualStyle, setVisualStyle] = useVisualStyle();

  return (
    <>
      <Visualizer
        analysisRef={analysisRef}
        styleId={visualStyle}
        palette={paletteFor(track)}
        playing={isPlaying}
        getOrigin={() => {
          const el = discRef.current;
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2, radius: r.width / 2 };
        }}
      />

      <button
        ref={discRef}
        type="button"
        onClick={toggle}
        aria-label={`${isPlaying ? "Pause" : "Play"} ${track.title}`}
        className="mx-auto mt-8 block w-56 rounded-full transition hover:scale-[1.02] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-foreground sm:w-64"
      >
        <Disc track={track} spinning={hasStarted} paused={!isPlaying} className="w-full" />
      </button>

      {children}

      <div className="mt-8 flex items-center gap-4">
        <button
          type="button"
          onClick={toggle}
          aria-label={isPlaying ? "Pause" : "Play"}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition hover:opacity-80"
        >
          {isPlaying ? "❚❚" : "▶"}
        </button>
        <span className="w-10 text-right text-sm text-neutral-500 tabular-nums">{formatDuration(currentTime)}</span>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(currentTime, duration || 0)}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="Seek"
          aria-valuetext={`${formatDuration(currentTime)} of ${formatDuration(duration)}`}
          className="h-1.5 flex-1 cursor-pointer accent-foreground"
        />
        <span className="w-10 text-sm text-neutral-500 tabular-nums">{formatDuration(duration)}</span>
      </div>

      <StylePicker value={visualStyle} onChange={setVisualStyle} className="mt-6" />
    </>
  );
}
