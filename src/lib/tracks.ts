import "server-only";
import type { Track } from "@/types/track";
import { mockTracks } from "@/data/mock-tracks";

/**
 * Data-access layer. Everything that reads tracks goes through here,
 * so swapping mock data for Supabase only touches this file.
 */

export async function getTracks(): Promise<Track[]> {
  return [...mockTracks].sort((a, b) => b.releasedAt.localeCompare(a.releasedAt));
}

export async function getTrackBySlug(slug: string): Promise<Track | null> {
  return mockTracks.find((t) => t.slug === slug) ?? null;
}

export async function getTrackById(id: string): Promise<Track | null> {
  return mockTracks.find((t) => t.id === id) ?? null;
}

export async function incrementDownloadCount(id: string): Promise<void> {
  const track = mockTracks.find((t) => t.id === id);
  if (track) track.downloadCount += 1; // in-memory only; replace with a Supabase RPC
}
