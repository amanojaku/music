"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { Track } from "@/types/track";
import { AudioAnalysis } from "@/lib/visuals/analysis";

interface PlayerValue {
  track: Track;
  audioRef: RefObject<HTMLAudioElement | null>;
  analysisRef: RefObject<AudioAnalysis | null>;
  isPlaying: boolean;
  /** True once playback has started at least once (the disc keeps its angle after that). */
  hasStarted: boolean;
  currentTime: number;
  duration: number;
  toggle: () => void;
  seek: (seconds: number) => void;
}

const PlayerContext = createContext<PlayerValue | null>(null);

/**
 * Owns the track page's <audio> element and playback state, shared by the
 * player UI, the visuals and the notation cursor.
 */
export function PlayerProvider({ track, children }: { track: Track; children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const analysisRef = useRef<AudioAnalysis | null>(null);
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

  function toggle() {
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
    <PlayerContext.Provider
      value={{ track, audioRef, analysisRef, isPlaying, hasStarted, currentTime, duration, toggle, seek }}
    >
      <audio ref={audioRef} src={track.audioPath} preload="metadata" crossOrigin="anonymous" />
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer(): PlayerValue {
  const value = useContext(PlayerContext);
  if (!value) throw new Error("usePlayer must be used inside <PlayerProvider>");
  return value;
}
