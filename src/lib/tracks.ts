import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Track } from "@/types/track";
import { mockTracks } from "@/data/mock-tracks";
import publishedTracks from "@/data/tracks.json";

/**
 * Data-access layer. Everything that reads tracks goes through here,
 * so swapping the JSON files for a database only touches this file.
 *
 * - src/data/tracks.json: the published tracks (committed; bundled at build time).
 * - In development only, also the generated test tracks (mock-tracks.ts) and the
 *   optional, gitignored src/data/local-tracks.json for recordings being tested.
 */

const published = publishedTracks as unknown as Track[];
const isDevelopment = process.env.NODE_ENV === "development";

let localTracks: Track[] | null = null;
function loadLocalTracks(): Track[] {
  if (localTracks) return localTracks;
  try {
    localTracks = JSON.parse(readFileSync(path.join(process.cwd(), "src/data/local-tracks.json"), "utf8")) as Track[];
  } catch {
    localTracks = [];
  }
  return localTracks;
}

const allTracks = (): Track[] => (isDevelopment ? [...published, ...mockTracks, ...loadLocalTracks()] : published);

export async function getTracks(): Promise<Track[]> {
  return allTracks().sort((a, b) => b.releasedAt.localeCompare(a.releasedAt));
}

export async function getTrackBySlug(slug: string): Promise<Track | null> {
  return allTracks().find((t) => t.slug === slug) ?? null;
}

export async function getTrackById(id: string): Promise<Track | null> {
  return allTracks().find((t) => t.id === id) ?? null;
}
