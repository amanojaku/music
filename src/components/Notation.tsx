"use client";

import { useEffect, useRef, useState } from "react";
import type { AlphaTabApi } from "@coderline/alphatab";
import { usePlayer } from "@/components/PlayerContext";
import { mediaUrl } from "@/lib/media";

type View = "score" | "tab" | "both";

const VIEWS: Array<{ id: View; label: string }> = [
  { id: "score", label: "Notation" },
  { id: "tab", label: "Tab" },
  { id: "both", label: "Both" },
];

/** alphaTab StaveProfile.Default: each staff's own showStandardNotation/showTablature decide. */
const STAVE_PROFILE_DEFAULT = 0;

type ScoreModel = {
  tracks: Array<{
    staves: Array<{
      tuning: number[];
      showStandardNotation: boolean;
      showTablature: boolean;
      standardNotationLineCount: number;
    }>;
  }>;
};

/**
 * Show notation, tab or both. Works for both score layouts we get:
 *  - one guitar staff carrying the tuning (our transcription draft): it shows either or both;
 *  - a notation staff plus a linked tab staff (MuseScore's export): each shows its own part.
 */
function applyView(score: ScoreModel, view: View) {
  for (const track of score.tracks) {
    const withTuning = track.staves.filter((s) => s.tuning.length).length;
    const separateTab = withTuning > 0 && withTuning < track.staves.length;
    for (const staff of track.staves) {
      const isTab = staff.tuning.length > 0;
      if (isTab) staff.standardNotationLineCount = 5;
      staff.showStandardNotation = view !== "tab" && (!separateTab || !isTab);
      staff.showTablature = view !== "score" && isTab;
    }
  }
}

type Status = "loading" | "ready" | "error";

/**
 * alphaTab sizes a staff's string list from <staff-lines> (default 5), so a
 * six-string tuning without it loses a string and notes on it can't render.
 * Add the count where a staff lists tunings but no line count.
 */
function prepareMusicXml(xml: string): string {
  return xml.replace(/<staff-details([^>]*)>([\s\S]*?)<\/staff-details>/g, (match, attrs: string, body: string) => {
    const strings = body.match(/<staff-tuning\b/g)?.length ?? 0;
    if (!strings || body.includes("<staff-lines>")) return match;
    return `<staff-details${attrs}><staff-lines>${strings}</staff-lines>${body}</staff-details>`;
  });
}

/**
 * Sheet music and/or tab rendered by alphaTab, with a cursor that follows the
 * page's audio. Sync points (bar → time in the recording) keep it aligned with
 * a performance that wasn't played to a click. Must be inside <PlayerProvider>.
 */
export function Notation({ scorePath, syncPath }: { scorePath: string; syncPath: string | null }) {
  const { audioRef } = usePlayer();
  const containerRef = useRef<HTMLDivElement>(null);
  // The score scrolls inside its own box, so following the music never moves the page.
  const viewportRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<AlphaTabApi | null>(null);
  const [view, setView] = useState<View>("both");
  const viewRef = useRef<View>("both");
  const [status, setStatus] = useState<Status>("loading");

  // Create alphaTab, load the score, and drive its cursor from the <audio> element.
  useEffect(() => {
    const container = containerRef.current;
    const viewport = viewportRef.current;
    const audio = audioRef.current;
    if (!container || !viewport || !audio) return;
    let api: AlphaTabApi | null = null;
    let raf = 0;
    let cancelled = false;
    const cleanups: Array<() => void> = [];

    (async () => {
      const alphaTab = await import("@coderline/alphatab");
      const [scoreData, syncPoints] = await Promise.all([
        fetch(mediaUrl(scorePath)).then((r) => {
          if (!r.ok) throw new Error(`Score not found (${r.status})`);
          return r.text();
        }),
        syncPath ? fetch(mediaUrl(syncPath)).then((r) => (r.ok ? r.json() : null)) : Promise.resolve(null),
      ]);
      if (cancelled) return;

      api = new alphaTab.AlphaTabApi(container, {
        core: { fontDirectory: "/alphatab/font/", useWorkers: false },
        display: { staveProfile: STAVE_PROFILE_DEFAULT },
        player: {
          playerMode: alphaTab.PlayerMode.EnabledExternalMedia,
          enableCursor: true,
          enableAnimatedBeatCursor: true,
          enableElementHighlighting: true,
          // Keep the line with the current bar at the top of the score box.
          scrollMode: alphaTab.ScrollMode.Continuous,
          scrollElement: viewport,
          scrollOffsetY: -8,
        },
      });
      apiRef.current = api;
      // Diagnostics: with ?debug-visuals, expose the bar the cursor is on as window.__notationBar.
      if (new URLSearchParams(window.location.search).has("debug-visuals")) {
        api.playedBeatChanged.on((beat) => {
          (window as unknown as { __notationBar?: number }).__notationBar = beat.voice.bar.index;
        });
      }

      api.scoreLoaded.on((score) => {
        applyView(score, viewRef.current);
        if (syncPoints) score.applyFlatSyncPoints(syncPoints);
      });
      api.renderFinished.on(() => setStatus("ready"));
      api.error.on(() => setStatus("error"));

      // The recording is the time axis: alphaTab asks us to play/pause/seek it,
      // and we report its position back.
      api.playerReady.on(() => {
        const output = api!.player!.output as unknown as {
          handler: unknown;
          updatePosition(ms: number): void;
        };
        output.handler = {
          get backingTrackDuration() {
            return (audio.duration || 0) * 1000;
          },
          get playbackRate() {
            return audio.playbackRate;
          },
          set playbackRate(v: number) {
            audio.playbackRate = v;
          },
          get masterVolume() {
            return audio.volume;
          },
          set masterVolume(v: number) {
            audio.volume = v;
          },
          seekTo: (ms: number) => {
            audio.currentTime = ms / 1000;
          },
          play: () => void audio.play(),
          pause: () => audio.pause(),
        };

        const report = () => output.updatePosition(audio.currentTime * 1000);
        const loop = () => {
          report();
          raf = requestAnimationFrame(loop);
        };
        // Keep alphaTab's play state in step with playback started elsewhere (disc, play button).
        const onPlay = () => {
          if (api?.playerState !== alphaTab.synth.PlayerState.Playing) api?.play();
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(loop);
        };
        const onPause = () => {
          cancelAnimationFrame(raf);
          if (api?.playerState === alphaTab.synth.PlayerState.Playing) api?.pause();
          report();
        };
        const events: Array<[string, () => void]> = [
          ["play", onPlay],
          ["pause", onPause],
          ["ended", onPause],
          ["seeked", report],
        ];
        events.forEach(([e, fn]) => audio.addEventListener(e, fn));
        cleanups.push(() => events.forEach(([e, fn]) => audio.removeEventListener(e, fn)));
        report();
        if (!audio.paused) onPlay();
      });

      api.load(new TextEncoder().encode(prepareMusicXml(scoreData)));
    })().catch(() => !cancelled && setStatus("error"));

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      cleanups.forEach((fn) => fn());
      api?.destroy();
      apiRef.current = null;
    };
    // The view is applied separately (changeView) without reloading.
  }, [scorePath, syncPath, audioRef]);

  function changeView(next: View) {
    setView(next);
    viewRef.current = next;
    const api = apiRef.current;
    if (!api?.score) return;
    applyView(api.score, next);
    api.render();
  }

  return (
    <section className="mt-12" aria-labelledby="notation-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="notation-heading" className="text-sm font-medium tracking-wider text-neutral-500 uppercase">
          Score
        </h2>
        <fieldset className="flex gap-2 text-sm">
          <legend className="sr-only">Show</legend>
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              aria-pressed={view === v.id}
              onClick={() => changeView(v.id)}
              className={`rounded-full border px-3 py-1 transition ${
                view === v.id
                  ? "border-foreground bg-foreground text-background"
                  : "border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
              }`}
            >
              {v.label}
            </button>
          ))}
        </fieldset>
      </div>

      {/* Sheet music reads best as black on paper in either theme. */}
      <div
        ref={viewportRef}
        className="notation-paper relative mt-4 max-h-[75vh] overflow-y-auto overscroll-contain rounded-lg bg-white p-2 text-black shadow-sm ring-1 ring-black/5"
      >
        {status === "loading" && <p className="p-6 text-center text-sm text-neutral-500">Loading score…</p>}
        {status === "error" && (
          <p className="p-6 text-center text-sm text-neutral-500">The score couldn’t be loaded.</p>
        )}
        <div ref={containerRef} />
      </div>
      <p className="mt-2 text-xs text-neutral-500">Click a note to jump there in the recording.</p>
    </section>
  );
}
