"use client";

import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";
import type { Track } from "@/types/track";
import { JewelCase } from "@/components/JewelCase";
import { formatDate, formatDuration } from "@/lib/format";

/** Pixels of horizontal drag that move one case. */
const DRAG_PX_PER_STEP = 180;
const CLICK_SLOP_PX = 6;

/** Space between neighbouring cases round the circle, in case widths. */
const RING_SPACING = 1.3;
/** How far the selected case comes forward out of the circle, in case widths. */
const PULL_OUT = 0.9;
/** The circle is seen slightly from above. */
const TILT = 10; // degrees

const mod = (n: number, m: number) => ((n % m) + m) % m;

/** Ring radius (case widths) so neighbouring cases have RING_SPACING between centres. */
const ringRadius = (count: number) => RING_SPACING / 2 / Math.sin(Math.PI / Math.max(count, 3));

/**
 * A case's offset from the selected position, wrapped round the circle
 * (−n/2 … n/2; fractional while sliding), and how "selected" it is: 1 at the
 * front, fading to 0 one step away. The ring itself rotates by the unwrapped
 * position, so cases never sweep the long way round when offsets wrap.
 */
function layout(offset: number, count: number) {
  const rel = mod(offset + count / 2, count) - count / 2;
  return { rel, selectedness: Math.max(0, 1 - Math.abs(rel)) };
}

/**
 * Home-page browser: CD jewel cases on a 3D circle. The selected case comes
 * forward out of the circle to face you, with its disc lifted out; the rest
 * stay spaced round the ring behind it. Turn the circle by dragging (it
 * follows your finger), horizontal wheel, arrow keys, the buttons, or by
 * clicking a case. Clicking the selected case plays or pauses it.
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
    audio.src = track.audioPath;
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

  function onWheel(e: WheelEvent) {
    // Only horizontal gestures move the row; vertical scrolling scrolls the page.
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    wheelAccum.current += e.deltaX;
    const now = performance.now();
    if (Math.abs(wheelAccum.current) > 40 && now > wheelLock.current) {
      step(Math.sign(wheelAccum.current));
      wheelAccum.current = 0;
      wheelLock.current = now + 320;
    }
  }

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

  if (n === 0) return <p className="text-neutral-500">No tracks yet.</p>;

  const active = tracks[selected];
  const activeIsPlaying = playingId === active.id && isPlaying;
  const turn = position + (drag ?? 0);

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
        onWheel={onWheel}
        onKeyDown={onKeyDown}
      >
        <div
          className="cd-ring"
          data-dragging={drag !== null || undefined}
          style={
            {
              "--n": Math.max(n, 3),
              "--turn": turn,
              "--radius": ringRadius(n),
              "--pull": PULL_OUT,
              "--tilt": `${TILT}deg`,
            } as CSSProperties
          }
        >
          {tracks.map((track, i) => {
            const isActive = i === selected;
            const { rel, selectedness } = layout(i - turn, n);
            const style = {
              "--i": i,
              "--s": selectedness,
              "--dim": Math.min(0.7, Math.max(0, Math.abs(rel) - 0.3) * 0.22),
            } as CSSProperties;
            return (
              <button
                key={track.id}
                type="button"
                className="cd-item"
                style={style}
                onClick={() => {
                  if (suppressClick.current) return;
                  if (isActive) togglePlay(track);
                  else goTo(i);
                }}
                // Tabbing to a case selects it; a mouse press (which also focuses) must not,
                // or every drag would start by jumping to the case under the pointer.
                onFocus={(e) => !isActive && e.currentTarget.matches(":focus-visible") && goTo(i)}
                aria-label={
                  isActive
                    ? `${playingId === track.id && isPlaying ? "Pause" : "Play"} ${track.title}`
                    : `Show ${track.title}`
                }
                aria-current={isActive ? "true" : undefined}
              >
                <JewelCase
                  track={track}
                  open={isActive && drag === null}
                  spinning={playingId === track.id}
                  paused={!isPlaying}
                />
              </button>
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
