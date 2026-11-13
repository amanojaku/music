"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Track } from "@/types/track";
import { Disc } from "@/components/Disc";
import { formatDate, formatDuration } from "@/lib/format";
import { paletteFor } from "@/lib/colour";
import { useVisualStyle } from "@/lib/hooks";
import { AudioAnalysis } from "@/lib/visuals/analysis";
import { VISUAL_STYLES, type VisualStyleId } from "@/lib/visuals/styles";
import { Visualizer } from "@/components/Visualizer";

export function CdShelf({ tracks }: { tracks: Track[] }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const audioRef = useRef<HTMLAudioElement>(null);
  const analysisRef = useRef<AudioAnalysis | null>(null);
  const [visualStyle, setVisualStyle] = useVisualStyle();

  const [activeIndex, setActiveIndex] = useState(0);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  // Keep play state in sync with the audio element.
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

  // The disc nearest the centre of the shelf is the active one.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const center = scroller.scrollLeft + scroller.clientWidth / 2;
      let best = 0;
      let bestDist = Infinity;
      itemRefs.current.forEach((el, i) => {
        if (!el) return;
        const dist = Math.abs(el.offsetLeft + el.offsetWidth / 2 - center);
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      });
      setActiveIndex(best);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    scroller.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  const scrollToIndex = useCallback(
    (i: number) => {
      const index = Math.max(0, Math.min(tracks.length - 1, i));
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      itemRefs.current[index]?.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        inline: "center",
        block: "nearest",
      });
    },
    [tracks.length],
  );

  // Route audio through the analyser. Must run inside the click that starts playback.
  function connectAnalysis(audio: HTMLAudioElement) {
    try {
      analysisRef.current ??= new AudioAnalysis(audio);
      void analysisRef.current.resume();
    } catch {
      // Web Audio unavailable: music still plays, visuals stay idle.
    }
  }

  function togglePlay(track: Track) {
    const audio = audioRef.current;
    if (!audio) return;
    connectAnalysis(audio);
    if (playingId === track.id) {
      if (audio.paused) void audio.play();
      else audio.pause();
      return;
    }
    audio.src = track.audioPath;
    setPlayingId(track.id);
    void audio.play();
  }

  function onKeyDown(e: KeyboardEvent) {
    const moves: Record<string, number> = {
      ArrowRight: activeIndex + 1,
      ArrowLeft: activeIndex - 1,
      Home: 0,
      End: tracks.length - 1,
    };
    if (e.key in moves) {
      e.preventDefault();
      scrollToIndex(moves[e.key]);
    }
  }

  if (tracks.length === 0) {
    return <p className="text-neutral-500">No tracks yet.</p>;
  }

  const active = tracks[activeIndex];
  const activeIsPlaying = playingId === active.id && isPlaying;
  const playingIndex = tracks.findIndex((t) => t.id === playingId);
  const visualTrack = playingIndex >= 0 ? tracks[playingIndex] : active;

  return (
    <section aria-label="Tracks">
      <audio ref={audioRef} preload="none" crossOrigin="anonymous" />
      <Visualizer
        analysisRef={analysisRef}
        styleId={visualStyle}
        palette={paletteFor(visualTrack)}
        playing={isPlaying}
        getOrigin={() => {
          const el = itemRefs.current[playingIndex >= 0 ? playingIndex : activeIndex];
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2, radius: r.width / 2 };
        }}
      />

      <div className="relative">
        <div
          ref={scrollerRef}
          onKeyDown={onKeyDown}
          className="cd-shelf relative flex snap-x snap-mandatory items-center gap-6 overflow-x-auto py-8 outline-none sm:gap-10"
        >
          {tracks.map((track, i) => {
            const isActive = i === activeIndex;
            return (
              <button
                key={track.id}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                type="button"
                onClick={() => (isActive ? togglePlay(track) : scrollToIndex(i))}
                aria-label={
                  isActive
                    ? `${playingId === track.id && isPlaying ? "Pause" : "Play"} ${track.title}`
                    : `Select ${track.title}`
                }
                aria-current={isActive ? "true" : undefined}
                className={`cd-item snap-center rounded-full transition duration-300 ease-out focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-foreground ${
                  isActive ? "scale-100" : "scale-75 opacity-50 hover:opacity-80"
                }`}
              >
                <Disc
                  track={track}
                  spinning={playingId === track.id}
                  paused={!isPlaying}
                  className="h-full w-full"
                />
              </button>
            );
          })}
        </div>

        <ShelfArrow direction="prev" disabled={activeIndex === 0} onClick={() => scrollToIndex(activeIndex - 1)} />
        <ShelfArrow
          direction="next"
          disabled={activeIndex === tracks.length - 1}
          onClick={() => scrollToIndex(activeIndex + 1)}
        />
      </div>

      <div className="mt-2 flex justify-center gap-2" aria-hidden>
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

        <StylePicker value={visualStyle} onChange={setVisualStyle} />
      </div>
    </section>
  );
}

function ShelfArrow({
  direction,
  disabled,
  onClick,
}: {
  direction: "prev" | "next";
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={direction === "prev" ? "Previous track" : "Next track"}
      className={`absolute top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-neutral-300 bg-background/80 text-lg backdrop-blur transition hover:bg-neutral-100 disabled:pointer-events-none disabled:opacity-0 sm:flex dark:border-neutral-700 dark:hover:bg-neutral-900 ${
        direction === "prev" ? "left-0" : "right-0"
      }`}
    >
      {direction === "prev" ? "‹" : "›"}
    </button>
  );
}

const PICKER_OPTIONS: Array<{ id: VisualStyleId; label: string }> = [
  ...VISUAL_STYLES.map(({ id, label }) => ({ id: id as VisualStyleId, label })),
  { id: "off", label: "Off" },
];

function StylePicker({ value, onChange }: { value: VisualStyleId; onChange: (id: VisualStyleId) => void }) {
  return (
    <fieldset className="mt-8 flex flex-wrap items-center justify-center gap-2 text-sm">
      <legend className="sr-only">Visuals</legend>
      <span className="text-neutral-500" aria-hidden>
        Visuals
      </span>
      {PICKER_OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={`rounded-full border px-3 py-1 transition ${
            value === option.id
              ? "border-foreground bg-foreground text-background"
              : "border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
          }`}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  );
}
