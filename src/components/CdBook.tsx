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

/** Pixels of horizontal drag that turn one page. */
const DRAG_PX_PER_PAGE = 220;
const CLICK_SLOP_PX = 6;
/** Pages beyond this depth in either stack are drawn at the same depth (keeps big books compact). */
const MAX_STACK = 8;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Home-page browser: CD jewel cases bound like pages of a book. The spine runs
 * down the middle (the case hinge sits on it); the current case lies open on
 * the right with its disc lifted out, earlier cases are turned over to the
 * left, later ones wait underneath on the right. Flip by dragging (the page
 * follows your finger), horizontal wheel, arrow keys, the side buttons, or by
 * clicking a case. Clicking the open case plays or pauses it.
 */
export function CdBook({ tracks }: { tracks: Track[] }) {
  const n = tracks.length;
  const audioRef = useRef<HTMLAudioElement>(null);
  const bookRef = useRef<HTMLDivElement>(null);

  const [page, setPage] = useState(0);
  const [drag, setDrag] = useState<number | null>(null); // pages turned so far in the current drag
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const dragStart = useRef<{ x: number; pointer: number } | null>(null);
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

  // Keyboard users: keep focus on the open case as pages turn.
  useEffect(() => {
    const book = bookRef.current;
    const focused = document.activeElement;
    if (!book || !(focused instanceof HTMLElement) || !focused.classList.contains("cd-page")) return;
    if (!book.contains(focused)) return;
    book.querySelectorAll<HTMLElement>(".cd-page")[page]?.focus({ preventScroll: true });
  }, [page]);

  const goTo = (i: number) => setPage(clamp(i, 0, n - 1));

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
    // Drag left to turn forward, like a real page. Resist past the covers.
    if (suppressClick.current) setDrag(clamp(-dx / DRAG_PX_PER_PAGE, -page - 0.15, n - 1 - page + 0.15));
  }

  function endDrag(e: PointerEvent) {
    const start = dragStart.current;
    if (!start || start.pointer !== e.pointerId) return;
    dragStart.current = null;
    if (drag !== null) goTo(page + Math.round(drag));
    setDrag(null);
    // Swallow only the click that ends this drag; later clicks (incl. keyboard) must work.
    if (suppressClick.current) setTimeout(() => (suppressClick.current = false), 0);
  }

  function onWheel(e: WheelEvent) {
    // Only horizontal gestures turn pages; vertical scrolling scrolls the page.
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    wheelAccum.current += e.deltaX;
    const now = performance.now();
    if (Math.abs(wheelAccum.current) > 40 && now > wheelLock.current) {
      goTo(page + Math.sign(wheelAccum.current));
      wheelAccum.current = 0;
      wheelLock.current = now + 320;
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    const moves: Record<string, number> = { ArrowRight: page + 1, ArrowLeft: page - 1, Home: 0, End: n - 1 };
    if (e.key in moves) {
      e.preventDefault();
      goTo(moves[e.key]);
    }
  }

  if (n === 0) return <p className="text-neutral-500">No tracks yet.</p>;

  const active = tracks[page];
  const activeIsPlaying = playingId === active.id && isPlaying;
  const position = page + (drag ?? 0);

  return (
    <section aria-label="Tracks" aria-roledescription="carousel">
      <audio ref={audioRef} preload="none" />

      <div
        ref={bookRef}
        className="cd-book relative select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
      >
        <div className="cd-pages" data-dragging={drag !== null || undefined}>
          {tracks.map((track, i) => {
            const isActive = i === page;
            // rel < 0: turned (left); 0: open; > 0: still to come (right).
            const rel = i - position;
            const turned = clamp(-rel, 0, 1); // 0 = lying on the right, 1 = turned over to the left
            const depth = Math.min(MAX_STACK, rel > 0 ? rel : Math.max(0, -rel - 1));
            const style = {
              "--angle": `${-180 * turned}deg`,
              "--depth": depth,
              "--lift": Math.sin(Math.PI * turned), // a turning page rises off the stacks
              "--dim": Math.min(0.7, depth * 0.16),
            } as CSSProperties;
            return (
              <button
                key={track.id}
                type="button"
                className="cd-page"
                style={style}
                onClick={() => {
                  if (suppressClick.current) return;
                  if (isActive) togglePlay(track);
                  else goTo(i);
                }}
                onFocus={() => !isActive && goTo(i)}
                aria-label={
                  isActive
                    ? `${playingId === track.id && isPlaying ? "Pause" : "Play"} ${track.title}`
                    : `Turn to ${track.title}`
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

        <PageArrow direction="prev" disabled={page === 0} onClick={() => goTo(page - 1)} />
        <PageArrow direction="next" disabled={page === n - 1} onClick={() => goTo(page + 1)} />
      </div>

      <div className="flex justify-center gap-2" aria-hidden>
        {tracks.map((t, i) => (
          <span
            key={t.id}
            className={`h-1.5 rounded-full transition-all ${
              i === page ? "w-6 bg-foreground" : "w-1.5 bg-neutral-300 dark:bg-neutral-700"
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

function PageArrow({ direction, disabled, onClick }: { direction: "prev" | "next"; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      onPointerDown={(e) => e.stopPropagation()}
      disabled={disabled}
      aria-label={direction === "prev" ? "Previous track" : "Next track"}
      className={`absolute top-1/2 z-10 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-neutral-300 bg-background/80 text-lg backdrop-blur transition hover:bg-neutral-100 disabled:pointer-events-none disabled:opacity-0 sm:flex dark:border-neutral-700 dark:hover:bg-neutral-900 ${
        direction === "prev" ? "left-0" : "right-0"
      }`}
    >
      {direction === "prev" ? "‹" : "›"}
    </button>
  );
}
