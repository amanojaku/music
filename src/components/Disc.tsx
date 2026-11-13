import type { CSSProperties } from "react";
import type { Track } from "@/types/track";
import { hueFor } from "@/lib/colour";

type Props = {
  track: Track;
  /** Spin animation is attached (play state controlled by `paused`). */
  spinning?: boolean;
  paused?: boolean;
  className?: string;
};

export function Disc({ track, spinning = false, paused = false, className = "" }: Props) {
  const hue = hueFor(track.slug);
  const labelStyle = {
    "--label-from": `hsl(${hue} 70% 58%)`,
    "--label-to": `hsl(${(hue + 40) % 360} 65% 32%)`,
    ...(track.coverUrl ? { backgroundImage: `url(${track.coverUrl})` } : {}),
  } as CSSProperties;
  const year = new Date(track.releasedAt).getFullYear();

  return (
    <div className={`cd-shadow relative aspect-square ${className}`}>
      <div
        className={`cd-disc absolute inset-0 ${spinning ? "cd-spinning" : ""}`}
        style={spinning ? { animationPlayState: paused ? "paused" : "running" } : undefined}
      >
        <div className="cd-surface" />
        <div className="cd-label" style={labelStyle}>
          <p className="absolute inset-x-[16%] top-[11%] line-clamp-2 text-center text-xs leading-tight font-semibold sm:text-sm">
            {track.title}
          </p>
          <div className="absolute inset-x-[18%] bottom-[9%] text-center text-[9px] leading-snug tracking-wider uppercase opacity-85 sm:text-[10px]">
            {track.genre && <p className="truncate">{track.genre}</p>}
            <p>{year}</p>
          </div>
        </div>
        <div className="cd-hub" />
      </div>
      <div className="cd-hole" />
      <div className="cd-shine" />
    </div>
  );
}
