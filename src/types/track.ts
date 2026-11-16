import type { Mode, Tonic, Tuning } from "@/lib/music-theory";

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
  /** Full-quality file for downloads (e.g. WAV). Falls back to audioPath. */
  downloadPath: string | null;
  coverUrl: string | null;
  /** Tonic in ASCII, e.g. "G", "F#", "Bb". Null if not set. */
  keyTonic: Tonic | null;
  keyMode: Mode | null;
  /** Guitar tuning, strings low → high with octave, e.g. ["E2","A2","E3","G3","B3","E4"]. Null = standard. */
  tuning: Tuning | null;
  /** MusicXML score for the notation view (draft from `npm run transcribe`, tidied in MuseScore). */
  notationPath: string | null;
  /** JSON sync points (bar → time in the recording) so the notation cursor follows the audio. */
  syncPath: string | null;
}
