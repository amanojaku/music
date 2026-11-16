import type { CSSProperties } from "react";
import type { Track } from "@/types/track";
import { hueFor } from "@/lib/colour";

/**
 * Square album artwork. Uses the track's cover image when it has one,
 * otherwise generated art in the track's label colours.
 */
export function CoverArt({ track, className = "" }: { track: Track; className?: string }) {
  const hue = hueFor(track.slug);
  const style = {
    "--cover-a": `hsl(${hue} 70% 55%)`,
    "--cover-b": `hsl(${(hue + 40) % 360} 65% 28%)`,
    "--cover-c": `hsl(${(hue + 200) % 360} 80% 70%)`,
  } as CSSProperties;

  if (track.coverUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- decorative art inside a 3D transform
      <img src={track.coverUrl} alt="" className={`h-full w-full object-cover ${className}`} draggable={false} />
    );
  }

  return (
    <div className={`cover-art relative h-full w-full overflow-hidden ${className}`} style={style}>
      <div className="absolute inset-x-[8%] top-[7%] text-[0.55em] font-semibold tracking-[0.3em] uppercase opacity-80">
        My Music
      </div>
      <div className="absolute inset-x-[8%] bottom-[8%]">
        <div className="text-[1.35em] leading-none font-bold tracking-tight">{track.title}</div>
        {track.genre && (
          <div className="mt-[0.4em] text-[0.55em] tracking-[0.25em] uppercase opacity-80">{track.genre}</div>
        )}
      </div>
    </div>
  );
}
