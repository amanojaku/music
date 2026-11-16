"use client";

import Link from "next/link";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import type { Track } from "@/types/track";
import { JewelCase } from "@/components/JewelCase";
import { formatDate, formatDuration } from "@/lib/format";
import { mediaUrl } from "@/lib/media";

/** Pixels of horizontal drag that move one case. */
const DRAG_PX_PER_STEP = 180;
const CLICK_SLOP_PX = 6;

// Layout, in case widths. The selected case faces you; each case further out sits further
// back round a curve behind it and turns another STEP_ANGLE back towards the middle.
/** Extra turn per case away from the selected one. */
const STEP_ANGLE = 33; // degrees
/** Distance between neighbouring case centres, in case widths. Under 1 so each case tucks
 * slightly behind the one in front (the selected case overlaps its neighbours' inner edges). */
const SPACING = 0.85;
/** The scene is seen slightly from above. */
const TILT = 8; // degrees
/** Cases turned further than this are past the side of the view and hidden. */
const MAX_VISIBLE_ANGLE = 110; // degrees

const mod = (n: number, m: number) => ((n % m) + m) % m;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Radius of the curve the cases sit on (its centre is behind the selected case). */
const CURVE_RADIUS = SPACING / (2 * Math.sin(rad(STEP_ANGLE / 2)));

/**
 * Pose for a case `offset` steps from the selected one (fractional while
 * sliding; wraps round). Each step out moves the case further round the
 * curve behind the selected one and turns it another STEP_ANGLE back
 * towards the middle, so its cover stays towards the viewer.
 */
function layout(offset: number, count: number) {
  const rel = mod(offset + count / 2, count) - count / 2; // −n/2 … n/2
  const theta = rel * STEP_ANGLE;
  return {
    rel,
    selectedness: Math.max(0, 1 - Math.abs(rel)),
    x: CURVE_RADIUS * Math.sin(rad(theta)),
    z: -CURVE_RADIUS * (1 - Math.cos(rad(theta))),
    angle: -theta,
    hidden: Math.abs(theta) > MAX_VISIBLE_ANGLE,
  };
}

/**
 * Home-page browser: the selected CD jewel case faces you, disc lifted out;
 * the others curve away behind it, the cases either side turned 33° back
 * towards it, the next ones 66°, and so on. Slide by
 * dragging (cases follow your finger), horizontal wheel, arrow keys, the
 * buttons, or by clicking a case. Clicking the selected case plays or pauses it.
 */
export function CdCarousel({ tracks }: { tracks: Track[] }) {
  const n = tracks.length;
  const audioRef = useRef<HTMLAudioElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  // Unwrapped position, so turning past the last case keeps going the short way round.
  const [position, setPosition] = useState(0);
  const selected = n ? mod(position, n) : 0;
  const [drag, setDrag] = useState<number | null>(null); // pages turned so far in the current drag
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const dragStart = useRef<{ x: number; pointer: number } | null>(null);
  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  // Each case's previous offset, to spot cases wrapping round from one end to the other.
  const lastRel = useRef<number[]>([]);
  // Latest drag amount, read on release (state may not have re-rendered after the last move).
  const dragAmount = useRef<number | null>(null);
  const suppressClick = useRef(false);
  const wheelAccum = useRef(0);
  const wheelLock = useRef(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onPause);
    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onPause);
    };
  }, []);

  // Keyboard users: keep focus on the selected case as the row slides.
  useEffect(() => {
    const row = rowRef.current;
    const focused = document.activeElement;
    if (!row || !(focused instanceof HTMLElement) || !focused.classList.contains("cd-item")) return;
    if (!row.contains(focused)) return;
    row.querySelectorAll<HTMLElement>(".cd-item")[selected]?.focus({ preventScroll: true });
  }, [selected]);

  /** Turn so case `i` is selected, the shortest way round. */
  function goTo(i: number) {
    let delta = mod(i - selected, n);
    if (delta > n / 2) delta -= n;
    setPosition((p) => p + delta);
  }
  const step = (by: number) => setPosition((p) => p + by);

  function togglePlay(track: Track) {
    const audio = audioRef.current;
    if (!audio) return;
    if (playingId === track.id) {
      if (audio.paused) void audio.play();
      else audio.pause();
      return;
    }
    audio.src = mediaUrl(track.audioPath);
    setPlayingId(track.id);
    void audio.play();
  }

  // ---- input ----

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    dragStart.current = { x: e.clientX, pointer: e.pointerId };
    suppressClick.current = false;
  }

  function onPointerMove(e: PointerEvent) {
    const start = dragStart.current;
    if (!start || start.pointer !== e.pointerId) return;
    const dx = e.clientX - start.x;
    if (!suppressClick.current && Math.abs(dx) > CLICK_SLOP_PX) {
      suppressClick.current = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    // Drag left to turn forward.
    if (suppressClick.current) {
      dragAmount.current = -dx / DRAG_PX_PER_STEP;
      setDrag(dragAmount.current);
    }
  }

  function endDrag(e: PointerEvent) {
    const start = dragStart.current;
    if (!start || start.pointer !== e.pointerId) return;
    dragStart.current = null;
    if (dragAmount.current !== null) step(Math.round(dragAmount.current));
    dragAmount.current = null;
    setDrag(null);
    // Swallow only the click that ends this drag; later clicks (incl. keyboard) must work.
    if (suppressClick.current) setTimeout(() => (suppressClick.current = false), 0);
  }

  // Horizontal scrolling only (trackpad swipes, Shift+wheel, tilt wheels) turns the carousel.
  // Vertical scrolling is left alone so it always scrolls the page. Attached natively because
  // React's wheel listener is passive and can't stop the browser's own horizontal handling.
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const onWheel = (e: globalThis.WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return; // mostly vertical: let the page scroll
      e.preventDefault();
      wheelAccum.current += e.deltaX;
      const now = performance.now();
      if (Math.abs(wheelAccum.current) > 40 && now > wheelLock.current) {
        // Capture the direction now: React may run the updater after the reset below.
        const direction = Math.sign(wheelAccum.current);
        setPosition((p) => p + direction);
        wheelAccum.current = 0;
        wheelLock.current = now + 320;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  function onKeyDown(e: KeyboardEvent) {
    const moves: Record<string, () => void> = {
      ArrowRight: () => step(1),
      ArrowLeft: () => step(-1),
      Home: () => goTo(0),
      End: () => goTo(n - 1),
    };
    if (moves[e.key]) {
      e.preventDefault();
      moves[e.key]();
    }
  }

  const turn = position + (drag ?? 0);

  // A case wrapping from one end of the curve to the other would sweep across the view.
  // Before the browser paints, switch its transition off so it jumps instead (it's hidden
  // round the back when it does), then switch it back on.
  useLayoutEffect(() => {
    itemRefs.current.forEach((el, i) => {
      const { rel } = layout(i - turn, n);
      const previous = lastRel.current[i];
      lastRel.current[i] = rel;
      if (!el || previous === undefined || Math.abs(rel - previous) <= n / 2) return;
      el.style.transition = "none";
      requestAnimationFrame(() => requestAnimationFrame(() => (el.style.transition = "")));
    });
  }, [turn, n]);

  if (n === 0) return <p className="text-neutral-500">No tracks yet.</p>;

  const active = tracks[selected];
  const activeIsPlaying = playingId === active.id && isPlaying;

  return (
    <section aria-label="Tracks" aria-roledescription="carousel">
      <audio ref={audioRef} preload="none" />

      <div
        ref={rowRef}
        className="cd-carousel relative select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
      >
        <div
          className="cd-ring"
          data-dragging={drag !== null || undefined}
          style={{ "--tilt": `${TILT}deg` } as CSSProperties}
        >
          {tracks.map((track, i) => {
            const isActive = i === selected;
            const { rel, selectedness, x, z, angle, hidden } = layout(i - turn, n);
            const style = {
              "--x": x,
              "--z": z,
              "--angle": `${angle}deg`,
              "--s": selectedness,
              "--dim": Math.min(0.7, Math.max(0, Math.abs(rel) - 0.3) * 0.22),
            } as CSSProperties;
            return (
              <Link
                key={track.id}
                href={`/tracks/${track.slug}`}
                className="cd-item"
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                draggable={false}
                data-hidden={hidden || undefined}
                tabIndex={hidden ? -1 : undefined}
                style={style}
                // The front case opens its track page; a side case is brought to the front first.
                // Modified clicks (new tab/window) always follow the link.
                onClick={(e) => {
                  if (suppressClick.current) {
                    e.preventDefault();
                    return;
                  }
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                  if (!isActive) {
                    e.preventDefault();
                    goTo(i);
                  }
                }}
                // Tabbing to a case selects it; a mouse press (which also focuses) must not,
                // or every drag would start by jumping to the case under the pointer.
                onFocus={(e) => !isActive && e.currentTarget.matches(":focus-visible") && goTo(i)}
                aria-label={isActive ? `Open ${track.title}` : `Show ${track.title}`}
                aria-current={isActive ? "true" : undefined}
              >
                <JewelCase
                  track={track}
                  open={isActive && drag === null}
                  spinning={playingId === track.id}
                  paused={!isPlaying}
                />
              </Link>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-center gap-4">
        <StepButton direction="prev" onClick={() => step(-1)} />
        <div className="flex gap-2" aria-hidden>
          {tracks.map((t, i) => (
            <span
              key={t.id}
              className={`h-1.5 rounded-full transition-all ${
                i === selected ? "w-6 bg-foreground" : "w-1.5 bg-neutral-300 dark:bg-neutral-700"
              }`}
            />
          ))}
        </div>
        <StepButton direction="next" onClick={() => step(1)} />
      </div>

      <div className="mx-auto mt-8 max-w-md text-center" aria-live="polite">
        <h2 className="text-2xl font-bold tracking-tight">
          <Link href={`/tracks/${active.slug}`} className="hover:underline">
            {active.title}
          </Link>
        </h2>
        <p className="mt-1 text-sm text-neutral-500">
          {[active.genre, formatDate(active.releasedAt), formatDuration(active.durationSeconds)]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {active.description && <p className="mt-3 text-neutral-600 dark:text-neutral-400">{active.description}</p>}

        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => togglePlay(active)}
            className="min-w-28 rounded-full bg-foreground px-5 py-2.5 font-medium text-background transition hover:opacity-80"
          >
            {activeIsPlaying ? "❚❚ Pause" : "▶ Play"}
          </button>
          <a
            href={`/api/tracks/${active.id}/download`}
            className="rounded-full border border-neutral-300 px-5 py-2.5 font-medium transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
          >
            Download
          </a>
        </div>
      </div>
    </section>
  );
}

function StepButton({ direction, onClick }: { direction: "prev" | "next"; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={direction === "prev" ? "Previous track" : "Next track"}
      className="flex h-9 w-9 items-center justify-center rounded-full border border-neutral-300 text-lg transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
    >
      {direction === "prev" ? "‹" : "›"}
    </button>
  );
}
