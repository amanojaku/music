import { readFile } from "node:fs/promises";
import path from "node:path";
import { getTrackById, incrementDownloadCount } from "@/lib/tracks";

const AUDIO_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
};

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const track = await getTrackById(id);
  if (!track) return new Response("Not found", { status: 404 });

  // Mock: serve from /public. With Supabase Storage, generate a signed URL
  // (createSignedUrl(path, 60, { download: filename })) and redirect to it instead.
  const publicDir = path.join(process.cwd(), "public");
  const filePath = path.join(publicDir, track.downloadPath ?? track.audioPath);
  if (!filePath.startsWith(publicDir + path.sep)) {
    return new Response("Bad path", { status: 400 });
  }

  let data: Buffer;
  try {
    data = await readFile(filePath);
  } catch {
    return new Response("File missing", { status: 404 });
  }

  await incrementDownloadCount(track.id);

  const ext = path.extname(filePath);
  const filename = `${track.title}${ext}`;
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": AUDIO_TYPES[ext.toLowerCase()] ?? "application/octet-stream",
      "Content-Length": String(data.length),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
