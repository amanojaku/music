import type { Mode, Tonic } from "@/lib/music-theory";

export interface Track {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  genre: string | null;
  /** Duration in seconds */
  durationSeconds: number;
  /** ISO date string */
  releasedAt: string;
  /** Path/key of the audio file. Relative to /public for mock data; a Supabase Storage key later. */
  audioPath: string;
  coverUrl: string | null;
  /** Tonic in ASCII, e.g. "G", "F#", "Bb". Null if not set. */
  keyTonic: Tonic | null;
  keyMode: Mode | null;
  downloadCount: number;
}
