import { readFile } from "node:fs/promises";
import path from "node:path";
import { CONTENT_TYPES, downloadDisposition, isBucketKey, mediaUrl } from "@/lib/media";
import { getTrackById, incrementDownloadCount } from "@/lib/tracks";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const track = await getTrackById(id);
  if (!track) return new Response("Not found", { status: 404 });

  const file = track.downloadPath ?? track.audioPath;

  // R2: the object was uploaded with a Content-Disposition naming it after the track
  // (see scripts/upload-media.ts), so count the download and send the browser there.
  if (isBucketKey(file)) {
    await incrementDownloadCount(track.id);
    return Response.redirect(mediaUrl(file), 302);
  }

  // Local file in public/ (generated mock tracks).
  const publicDir = path.join(process.cwd(), "public");
  const filePath = path.join(publicDir, file);
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
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": CONTENT_TYPES[ext.toLowerCase()] ?? "application/octet-stream",
      "Content-Length": String(data.length),
      "Content-Disposition": downloadDisposition(track.title, ext),
    },
  });
}
