"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Track } from "@/types/track";
import { Disc } from "@/components/Disc";
import { StylePicker } from "@/components/StylePicker";
import { Visualizer } from "@/components/Visualizer";
import { paletteFor } from "@/lib/colour";
import { formatDuration } from "@/lib/format";
import { useVisualStyle } from "@/lib/hooks";
import { AudioAnalysis } from "@/lib/visuals/analysis";

type Props = {
  track: Track;
  /** Rendered between the disc and the transport controls (title, details…). */
  children?: ReactNode;
};

/**
 * Track page player: a clickable spinning disc, transport controls, and the
 * live visuals drawn behind the page, centred on the disc.
 */
export function TrackPlayer({ track, children }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const discRef = useRef<HTMLButtonElement>(null);
  const analysisRef = useRef<AudioAnalysis | null>(null);
  const [visualStyle, setVisualStyle] = useVisualStyle();

  const [isPlaying, setIsPlaying] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(track.durationSeconds);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlay = () => {
      setIsPlaying(true);
      setHasStarted(true);
    };
    const onPause = () => setIsPlaying(false);
    const onTime = () => setCurrentTime(audio.currentTime);
    const onMeta = () => Number.isFinite(audio.duration) && setDuration(audio.duration);
    const events: Array<[string, () => void]> = [
      ["play", onPlay],
      ["pause", onPause],
      ["ended", onPause],
      ["timeupdate", onTime],
      ["seeked", onTime],
      ["loadedmetadata", onMeta],
    ];
    events.forEach(([e, fn]) => audio.addEventListener(e, fn));
    return () => events.forEach(([e, fn]) => audio.removeEventListener(e, fn));
  }, []);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    // Route audio through the analyser; must happen inside the click that starts playback.
    try {
      analysisRef.current ??= new AudioAnalysis(audio);
      void analysisRef.current.resume();
    } catch {
      // Web Audio unavailable: music still plays, visuals stay idle.
    }
    if (audio.paused) void audio.play();
    else audio.pause();
  }

  function seek(seconds: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = seconds;
    setCurrentTime(seconds);
  }

  return (
    <>
      <audio ref={audioRef} src={track.audioPath} preload="metadata" crossOrigin="anonymous" />
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
        onClick={togglePlay}
        aria-label={`${isPlaying ? "Pause" : "Play"} ${track.title}`}
        className="mx-auto mt-8 block w-56 rounded-full transition hover:scale-[1.02] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-foreground sm:w-64"
      >
        <Disc track={track} spinning={hasStarted} paused={!isPlaying} className="w-full" />
      </button>

      {children}

      <div className="mt-8 flex items-center gap-4">
        <button
          type="button"
          onClick={togglePlay}
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
