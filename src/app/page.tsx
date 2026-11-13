import { TrackList } from "@/components/TrackList";
import { getTracks } from "@/lib/tracks";

export const dynamic = "force-dynamic";

export default async function Home() {
  const tracks = await getTracks();

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <header className="mb-10">
        <h1 className="text-3xl font-bold tracking-tight">My Music</h1>
        <p className="mt-2 text-neutral-500">Listen and download free.</p>
      </header>
      <TrackList tracks={tracks} />
    </main>
  );
}
