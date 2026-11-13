"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Track } from "@/types/track";
import { formatDate, formatDuration } from "@/lib/format";

export function TrackList({ tracks }: { tracks: Track[] }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

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

  function toggle(track: Track) {
    const audio = audioRef.current;
    if (!audio) return;
    if (currentId === track.id) {
      if (audio.paused) void audio.play();
      else audio.pause();
      return;
    }
    audio.src = track.audioPath;
    setCurrentId(track.id);
    void audio.play();
  }

  if (tracks.length === 0) {
    return <p className="text-neutral-500">No tracks yet.</p>;
  }

  return (
    <>
      <audio ref={audioRef} preload="none" />
      <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
        {tracks.map((track) => {
          const active = currentId === track.id && isPlaying;
          return (
            <li key={track.id} className="flex items-center gap-4 py-4">
              <button
                type="button"
                onClick={() => toggle(track)}
                aria-label={active ? `Pause ${track.title}` : `Play ${track.title}`}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition hover:opacity-80"
              >
                {active ? "❚❚" : "▶"}
              </button>
              <div className="min-w-0 flex-1">
                <Link href={`/tracks/${track.slug}`} className="font-medium hover:underline">
                  {track.title}
                </Link>
                <p className="text-sm text-neutral-500">
                  {[track.genre, formatDate(track.releasedAt)].filter(Boolean).join(" · ")}
                </p>
              </div>
              <span className="hidden text-sm tabular-nums text-neutral-500 sm:block">
                {formatDuration(track.durationSeconds)}
              </span>
              <a
                href={`/api/tracks/${track.id}/download`}
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
              >
                Download
              </a>
            </li>
          );
        })}
      </ul>
    </>
  );
}
