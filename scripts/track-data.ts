/**
 * Track lookups for the command-line scripts.
 *
 * Real tracks live in src/data/tracks.json (committed, published); tracks being
 * tested privately can go in src/data/local-tracks.json (gitignored); generated
 * test tracks come from src/data/mock-tracks.ts.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mockTracks } from "../src/data/mock-tracks";
import type { Track } from "../src/types/track";

export const TRACK_FILES = ["src/data/tracks.json", "src/data/local-tracks.json"] as const;
export type TrackFile = (typeof TRACK_FILES)[number];

export function readTrackFile(file: TrackFile): Track[] {
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Track[]) : [];
}

/** Find a track in the JSON track files (where it can be edited), or among the mock tracks. */
export function findTrack(slug: string): { track: Track; file: TrackFile | null } {
  for (const file of TRACK_FILES) {
    const track = readTrackFile(file).find((t) => t.slug === slug);
    if (track) return { track, file };
  }
  const mock = mockTracks.find((t) => t.slug === slug);
  if (mock) return { track: mock, file: null };
  throw new Error(`No track "${slug}" in ${TRACK_FILES.join(", ")} or the mock tracks`);
}

/** Write a changed track back to the file it came from. */
export function saveTrack(file: TrackFile, track: Track) {
  const tracks = readTrackFile(file).map((t) => (t.slug === track.slug ? track : t));
  writeFileSync(file, JSON.stringify(tracks, null, 2) + "\n");
}
