/**
 * Manage track files in the R2 media bucket (via Wrangler; run `npx wrangler login` once).
 *
 *   npm run media -- cors                 apply r2-cors.json to the bucket (lets the site's
 *                                         visuals and notation read files cross-origin)
 *   npm run media -- upload <slug> [--dry-run]
 *                                         upload a local track's files to tracks/<slug>/… and
 *                                         point its entry in src/data/local-tracks.json at them
 *
 * Reads R2_BUCKET from .env.local. Downloads are uploaded with a Content-Disposition
 * naming them after the track, so the download route can simply redirect to them.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CONTENT_TYPES, downloadDisposition, isBucketKey } from "../src/lib/media";
import type { Track } from "../src/types/track";

const LOCAL_TRACKS = "src/data/local-tracks.json";
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
const FILES: Array<{ field: keyof Pick<Track, "audioPath" | "downloadPath" | "notationPath" | "syncPath">; name: (ext: string) => string; cache: string }> = [
  { field: "audioPath", name: (ext) => `audio${ext}`, cache: "public, max-age=86400" },
  { field: "downloadPath", name: (ext) => `download${ext}`, cache: "public, max-age=86400" },
  // Notation may be re-uploaded after edits in MuseScore, so keep its cache short.
  { field: "notationPath", name: () => "score.musicxml", cache: "public, max-age=300" },
  { field: "syncPath", name: () => "sync.json", cache: "public, max-age=300" },
];

function upload(slug: string, dryRun: boolean) {
  const tracks: Track[] = JSON.parse(readFileSync(LOCAL_TRACKS, "utf8"));
  const track = tracks.find((t) => t.slug === slug);
  if (!track) throw new Error(`No track "${slug}" in ${LOCAL_TRACKS}`);

  let changed = 0;
  for (const { field, name, cache } of FILES) {
    const current = track[field];
    if (!current || isBucketKey(current)) continue; // nothing to upload, or already in the bucket
    const file = path.join(process.cwd(), "public", current);
    if (!existsSync(file)) throw new Error(`${field}: ${file} not found`);

    const ext = path.extname(file).toLowerCase();
    const key = `tracks/${slug}/${name(ext)}`;
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

    console.log(`${field}: ${current} → ${key}`);
    if (!dryRun) wrangler(...args);
    track[field] = key;
    changed++;
  }

  if (!changed) return console.log(`Nothing to upload: ${slug}'s files are already in the bucket.`);
  if (dryRun) return console.log("(dry run: nothing uploaded, local-tracks.json unchanged)");
  writeFileSync(LOCAL_TRACKS, JSON.stringify(tracks, null, 2) + "\n");
  console.log(`Updated ${LOCAL_TRACKS}. Local copies in public/ were left in place.`);
}

function main() {
  const [command, slug] = process.argv.slice(2);
  if (command === "cors") return wrangler("r2", "bucket", "cors", "set", bucket(), "--file", "r2-cors.json");
  if (command === "upload" && slug) return upload(slug, process.argv.includes("--dry-run"));
  console.error("Usage: npm run media -- cors | upload <slug> [--dry-run]");
  process.exit(1);
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
