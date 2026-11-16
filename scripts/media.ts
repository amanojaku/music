/**
 * Manage track files in the R2 media bucket (via Wrangler; run `npx wrangler login` once).
 *
 *   npm run media -- cors                 apply r2-cors.json to the bucket (lets the site's
 *                                         visuals and notation read files cross-origin)
 *   npm run media -- upload <slug> [--dry-run]
 *                                         upload a track's local files to tracks/<slug>/… and point
 *                                         its entry (in tracks.json or local-tracks.json) at them
 *   npm run media -- replace <slug> <audio|download|notation|sync|cover> <file>
 *                                         overwrite one already-uploaded file, e.g. a score
 *                                         re-exported from MuseScore
 *   npm run media -- cover <slug> <image>  upload a square cover image (WebP/JPEG/PNG, ~800×800)
 *                                         and set the track's coverPath
 *
 * Reads R2_BUCKET from .env.local. Downloads are uploaded with a Content-Disposition
 * naming them after the track, so the download route can simply redirect to them.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { CONTENT_TYPES, downloadDisposition, isBucketKey } from "../src/lib/media";
import type { Track } from "../src/types/track";
import { findTrack, saveTrack } from "./track-data";

const WRANGLER = path.join(process.cwd(), "node_modules/.bin/wrangler");

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local
}

function bucket(): string {
  const name = process.env.R2_BUCKET;
  if (!name) throw new Error("Set R2_BUCKET in .env.local to your bucket's name");
  return name;
}

const wrangler = (...args: string[]) => execFileSync(WRANGLER, args, { stdio: "inherit" });

/** Which track fields hold files, what to call them in the bucket, and how to serve them. */
const FILES: Array<{
  field: keyof Pick<Track, "audioPath" | "downloadPath" | "notationPath" | "syncPath" | "coverPath">;
  name: (ext: string) => string;
  cache: string;
}> = [
  { field: "audioPath", name: (ext) => `audio${ext}`, cache: "public, max-age=86400" },
  { field: "downloadPath", name: (ext) => `download${ext}`, cache: "public, max-age=86400" },
  // Notation may be re-uploaded after edits in MuseScore, so keep its cache short.
  { field: "notationPath", name: () => "score.musicxml", cache: "public, max-age=300" },
  { field: "syncPath", name: () => "sync.json", cache: "public, max-age=300" },
  { field: "coverPath", name: (ext) => `cover${ext}`, cache: "public, max-age=86400" },
];

const FIELD_BY_NAME = {
  audio: "audioPath",
  download: "downloadPath",
  notation: "notationPath",
  sync: "syncPath",
  cover: "coverPath",
} as const;

const IMAGE_TYPES = [".webp", ".jpg", ".jpeg", ".png"];

/** Upload a cover image to tracks/<slug>/cover.<ext> and point the track at it. */
function cover(slug: string, file: string) {
  const { track, file: trackFile } = editableTrack(slug);
  if (!existsSync(file)) throw new Error(`${file} not found`);
  const ext = path.extname(file).toLowerCase();
  if (!IMAGE_TYPES.includes(ext))
    throw new Error(`Cover must be ${IMAGE_TYPES.join(", ")} (got ${ext || "no extension"})`);
  const key = `tracks/${slug}/cover${ext}`;
  console.log(`cover: ${file} → ${key}`);
  put(track, "coverPath", file, key);
  track.coverPath = key;
  saveTrack(trackFile, track);
  console.log(`Updated ${trackFile}.`);
}

/** A track whose entry the script can update (not one of the generated mock tracks). */
function editableTrack(slug: string) {
  const { track, file } = findTrack(slug);
  if (!file) throw new Error(`"${slug}" is a generated test track; add it to src/data/tracks.json first`);
  return { track, file };
}

/** Upload `file` to `key` with the right headers for `field`. */
function put(track: Track, field: (typeof FILES)[number]["field"], file: string, key: string) {
  const { cache } = FILES.find((f) => f.field === field)!;
  const ext = path.extname(file).toLowerCase();
  const args = [
    "r2",
    "object",
    "put",
    `${bucket()}/${key}`,
    "--file",
    file,
    "--content-type",
    CONTENT_TYPES[ext] ?? "application/octet-stream",
    "--cache-control",
    cache,
    "--remote",
  ];
  if (field === "downloadPath") args.push("--content-disposition", downloadDisposition(track.title, ext));
  wrangler(...args);
}

function replace(slug: string, name: string, file: string) {
  const field = FIELD_BY_NAME[name as keyof typeof FIELD_BY_NAME];
  if (!field) throw new Error(`Unknown file "${name}" (use audio, download, notation, sync or cover)`);
  const { track } = editableTrack(slug);
  const key = track[field];
  if (!key || !isBucketKey(key)) throw new Error(`${slug}'s ${name} isn't in the bucket yet; run upload first`);
  if (!existsSync(file)) throw new Error(`${file} not found`);
  if (path.extname(file).toLowerCase() !== path.extname(key).toLowerCase()) {
    throw new Error(`${file} doesn't match the uploaded file type (${path.extname(key)})`);
  }
  console.log(`${name}: ${file} → ${key}`);
  put(track, field, file, key);
}

function upload(slug: string, dryRun: boolean) {
  const { track, file: trackFile } = editableTrack(slug);

  let changed = 0;
  for (const { field, name } of FILES) {
    const current = track[field];
    if (!current || isBucketKey(current)) continue; // nothing to upload, or already in the bucket
    const file = path.join(process.cwd(), "public", current);
    if (!existsSync(file)) throw new Error(`${field}: ${file} not found`);

    const ext = path.extname(file).toLowerCase();
    const key = `tracks/${slug}/${name(ext)}`;
    console.log(`${field}: ${current} → ${key}`);
    if (!dryRun) put(track, field, file, key);
    track[field] = key;
    changed++;
  }

  if (!changed) return console.log(`Nothing to upload: ${slug}'s files are already in the bucket.`);
  if (dryRun) return console.log(`(dry run: nothing uploaded, ${trackFile} unchanged)`);
  saveTrack(trackFile, track);
  console.log(`Updated ${trackFile}. Local copies in public/ were left in place.`);
}

function main() {
  const [command, slug, name, file] = process.argv.slice(2);
  if (command === "cors") return wrangler("r2", "bucket", "cors", "set", bucket(), "--file", "r2-cors.json");
  if (command === "upload" && slug) return upload(slug, process.argv.includes("--dry-run"));
  if (command === "replace" && slug && name && file) return replace(slug, name, file);
  if (command === "cover" && slug && name) return cover(slug, name);
  console.error(
    "Usage: npm run media -- cors | upload <slug> [--dry-run] | replace <slug> <audio|download|notation|sync|cover> <file> | cover <slug> <image>",
  );
  process.exit(1);
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
