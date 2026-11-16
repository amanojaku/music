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

/** Pixels of horizontal drag that turn the ring by one case. */
const DRAG_PX_PER_STEP = 140;
const CLICK_SLOP_PX = 6;

const mod = (n: number, m: number) => ((n % m) + m) % m;

/**
 * Home-page carousel: CD jewel cases arranged on a 3D ring. The selected case
 * faces the viewer with its disc lifted out; the rest sit round the circle.
 * Turn it by dragging/swiping, horizontal wheel, arrow keys, the side buttons,
 * or by clicking a case. Clicking the front case plays or pauses it.
 */
export function CdCarousel({ tracks }: { tracks: Track[] }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const n = tracks.length;

  // Unwrapped ring position so turning past the last case keeps going the short way.
  const [position, setPosition] = useState(0);
  const [drag, setDrag] = useState<number | null>(null); // fractional steps while dragging
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const dragStart = useRef<{ x: number; pointer: number } | null>(null);
  const suppressClick = useRef(false);
  const wheelAccum = useRef(0);
  const wheelLock = useRef(0);

  const activeIndex = n ? mod(position, n) : 0;
  const stageRef = useRef<HTMLDivElement>(null);

  // If focus is inside the ring (keyboard use), keep it on the front case as the ring turns,
  // so the focus outline never ends up on a case at the back.
  useEffect(() => {
    const stage = stageRef.current;
    const focused = document.activeElement;
    if (!stage || !(focused instanceof HTMLElement) || !focused.classList.contains("cd-slot")) return;
    if (!stage.contains(focused)) return;
    stage.querySelectorAll<HTMLElement>(".cd-slot")[activeIndex]?.focus({ preventScroll: true });
  }, [activeIndex]);

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

  /** Turn so `index` is at the front, the shortest way round. */
  function goTo(index: number) {
    let delta = mod(index - activeIndex, n);
    if (delta > n / 2) delta -= n;
    setPosition((p) => p + delta);
  }

  function step(by: number) {
    setPosition((p) => p + by);
  }

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
    if (suppressClick.current) setDrag(-dx / DRAG_PX_PER_STEP);
  }

  function endDrag(e: PointerEvent) {
    const start = dragStart.current;
    if (!start || start.pointer !== e.pointerId) return;
    dragStart.current = null;
    if (drag !== null) setPosition((p) => p + Math.round(drag));
    setDrag(null);
    // Swallow only the click that ends this drag; later clicks (incl. keyboard) must work.
    if (suppressClick.current) setTimeout(() => (suppressClick.current = false), 0);
  }

  function onWheel(e: WheelEvent) {
    // Only horizontal gestures turn the ring; vertical scrolling scrolls the page.
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    wheelAccum.current += e.deltaX;
    const now = performance.now();
    if (Math.abs(wheelAccum.current) > 40 && now > wheelLock.current) {
      step(Math.sign(wheelAccum.current));
      wheelAccum.current = 0;
      wheelLock.current = now + 280;
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

  const active = tracks[activeIndex];
  const activeIsPlaying = playingId === active.id && isPlaying;
  const turn = position + (drag ?? 0);

  return (
    <section aria-label="Tracks" aria-roledescription="carousel">
      <audio ref={audioRef} preload="none" />

      <div
        ref={stageRef}
        className="cd-stage relative select-none"
        style={{ "--n": Math.max(n, 3) } as CSSProperties}
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
          style={{ "--turn": turn } as CSSProperties}
        >
          {tracks.map((track, i) => {
            const isActive = i === activeIndex;
            // Angular distance from the front, in steps (0 … n/2), for dimming.
            const offset = Math.abs(mod(i - turn + n / 2, n) - n / 2);
            return (
              <button
                key={track.id}
                type="button"
                className="cd-slot"
                style={{ "--i": i, "--dim": Math.min(0.75, offset * 0.28) } as CSSProperties}
                onClick={() => {
                  if (suppressClick.current) return;
                  if (isActive) togglePlay(track);
                  else goTo(i);
                }}
                onFocus={() => !isActive && goTo(i)}
                aria-label={
                  isActive ? `${playingId === track.id && isPlaying ? "Pause" : "Play"} ${track.title}` : `Show ${track.title}`
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

        <RingArrow direction="prev" onClick={() => step(-1)} />
        <RingArrow direction="next" onClick={() => step(1)} />
      </div>

      <div className="flex justify-center gap-2" aria-hidden>
        {tracks.map((t, i) => (
          <span
            key={t.id}
            className={`h-1.5 rounded-full transition-all ${
              i === activeIndex ? "w-6 bg-foreground" : "w-1.5 bg-neutral-300 dark:bg-neutral-700"
            }`}
          />
        ))}
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

function RingArrow({ direction, onClick }: { direction: "prev" | "next"; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      onPointerDown={(e) => e.stopPropagation()}
      aria-label={direction === "prev" ? "Previous track" : "Next track"}
      className={`absolute top-1/2 z-10 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-neutral-300 bg-background/80 text-lg backdrop-blur transition hover:bg-neutral-100 sm:flex dark:border-neutral-700 dark:hover:bg-neutral-900 ${
        direction === "prev" ? "left-0" : "right-0"
      }`}
    >
      {direction === "prev" ? "‹" : "›"}
    </button>
  );
}
