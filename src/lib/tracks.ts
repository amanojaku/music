import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Track } from "@/types/track";
import { mockTracks } from "@/data/mock-tracks";

/**
 * Data-access layer. Everything that reads tracks goes through here,
 * so swapping mock data for Supabase only touches this file.
 */

/**
 * Optional, gitignored src/data/local-tracks.json: real recordings used for
 * local testing that should never be committed. Same shape as Track[].
 */
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

const allTracks = () => [...mockTracks, ...loadLocalTracks()];

export async function getTracks(): Promise<Track[]> {
  return allTracks().sort((a, b) => b.releasedAt.localeCompare(a.releasedAt));
}

export async function getTrackBySlug(slug: string): Promise<Track | null> {
  return allTracks().find((t) => t.slug === slug) ?? null;
}

export async function getTrackById(id: string): Promise<Track | null> {
  return allTracks().find((t) => t.id === id) ?? null;
}

export async function incrementDownloadCount(id: string): Promise<void> {
  const track = allTracks().find((t) => t.id === id);
  if (track) track.downloadCount += 1; // in-memory only; replace with a Supabase RPC
}
