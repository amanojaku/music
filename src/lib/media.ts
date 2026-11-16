/**
 * Where track files (audio, downloads, notation) live.
 *
 * A path starting with "/" is a local file in public/ (the generated mock
 * tracks). Anything else is a key in the R2 media bucket, served from
 * NEXT_PUBLIC_MEDIA_BASE_URL (the bucket's public r2.dev or custom-domain URL).
 */

const BASE_URL = (process.env.NEXT_PUBLIC_MEDIA_BASE_URL ?? "").trim().replace(/\/+$/, "");

export const isBucketKey = (pathOrKey: string) => !pathOrKey.startsWith("/") && !/^https?:\/\//.test(pathOrKey);

/** Browser-usable URL for a track file. */
export function mediaUrl(pathOrKey: string): string {
  if (!isBucketKey(pathOrKey)) return pathOrKey;
  if (!BASE_URL) throw new Error(`NEXT_PUBLIC_MEDIA_BASE_URL is not set (needed for "${pathOrKey}")`);
  return `${BASE_URL}/${pathOrKey.split("/").map(encodeURIComponent).join("/")}`;
}

export const CONTENT_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".musicxml": "application/vnd.recordare.musicxml+xml",
  ".json": "application/json",
};

/** `attachment` Content-Disposition naming the file after the track, e.g. "River Song.wav". */
export function downloadDisposition(title: string, ext: string): string {
  return `attachment; filename*=UTF-8''${encodeURIComponent(`${title}${ext}`)}`;
}
