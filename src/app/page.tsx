import { CdCarousel } from "@/components/CdCarousel";
import { getTracks } from "@/lib/tracks";

export const dynamic = "force-dynamic";

export default async function Home() {
  const tracks = await getTracks();

  return (
    <main className="mx-auto max-w-5xl px-4 py-12">
      <header className="mb-4 text-center">
        <h1 className="text-6xl font-bold tracking-tight">Rob's Music</h1>
        <p className="mt-2 text-neutral-500">Music to share with you guys!</p>
      </header>
      <CdCarousel tracks={tracks} />
    </main>
  );
}
