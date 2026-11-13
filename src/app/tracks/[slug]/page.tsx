import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getTrackBySlug } from "@/lib/tracks";
import { formatDate, formatDuration } from "@/lib/format";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const track = await getTrackBySlug(slug);
  return { title: track ? `${track.title} · My Music` : "Track not found" };
}

export default async function TrackPage({ params }: Props) {
  const { slug } = await params;
  const track = await getTrackBySlug(slug);
  if (!track) notFound();

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <Link href="/" className="text-sm text-neutral-500 hover:underline">
        ← All tracks
      </Link>
      <h1 className="mt-6 text-3xl font-bold tracking-tight">{track.title}</h1>
      <p className="mt-2 text-neutral-500">
        {[track.genre, formatDate(track.releasedAt), formatDuration(track.durationSeconds)]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {track.description && <p className="mt-6">{track.description}</p>}
      <audio controls preload="metadata" src={track.audioPath} className="mt-8 w-full" />
      <div className="mt-6 flex items-center gap-4">
        <a
          href={`/api/tracks/${track.id}/download`}
          className="rounded-md bg-foreground px-4 py-2 text-background transition hover:opacity-80"
        >
          Download
        </a>
        <span className="text-sm text-neutral-500">{track.downloadCount} downloads</span>
      </div>
    </main>
  );
}
