import type { Track } from "@/types/track";
import { CoverArt } from "@/components/CoverArt";
import { Disc } from "@/components/Disc";

type Props = {
  track: Track;
  /** The disc slides up out of the case. */
  open: boolean;
  spinning: boolean;
  paused: boolean;
};

/**
 * A CD jewel case built from six CSS 3D faces (cover, tray card, spine and
 * edges) with the disc between them. Sized by --case-w / --case-h / --case-d
 * from .cd-stage; must sit inside a `transform-style: preserve-3d` parent.
 */
export function JewelCase({ track, open, spinning, paused }: Props) {
  return (
    <div className="jewel-case" data-open={open || undefined}>
      <div className="jewel-disc">
        <Disc track={track} spinning={spinning} paused={paused} className="h-full w-full" />
      </div>

      <div className="jewel-face jewel-front">
        <div className="jewel-hinge" />
        <div className="jewel-cover">
          <CoverArt track={track} />
        </div>
        <div className="jewel-sheen" />
      </div>

      <div className="jewel-face jewel-back">
        <CoverArt track={track} className="jewel-tray" />
      </div>

      <div className="jewel-face jewel-spine">
        <span>{track.title}</span>
      </div>
      <div className="jewel-face jewel-edge-right" />
      <div className="jewel-face jewel-edge-top" />
      <div className="jewel-face jewel-edge-bottom" />
    </div>
  );
}
