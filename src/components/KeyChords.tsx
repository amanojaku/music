import { diatonicTriads, type Key, type TriadQuality } from "@/lib/music-theory";
import { NoteName } from "@/components/NoteName";

const QUALITY_STYLE: Record<TriadQuality, string> = {
  major: "border-neutral-300 dark:border-neutral-700",
  minor: "border-neutral-300 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900",
  diminished: "border-dashed border-neutral-400 dark:border-neutral-600",
  augmented: "border-dashed border-neutral-400 dark:border-neutral-600",
};

export function KeyChords({ musicKey }: { musicKey: Key }) {
  const chords = diatonicTriads(musicKey);

  return (
    <section className="mt-10" aria-labelledby="key-heading">
      <h2 id="key-heading" className="text-sm font-medium tracking-wider text-neutral-500 uppercase">
        Key
      </h2>
      <p className="mt-1 text-2xl font-semibold">
        <NoteName value={musicKey.tonic} /> {musicKey.mode}
      </p>

      <h3 className="mt-6 text-sm font-medium tracking-wider text-neutral-500 uppercase">Diatonic chords</h3>
      <ol className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-7">
        {chords.map((chord) => (
          <li
            key={chord.degree}
            className={`flex flex-col items-center rounded-lg border px-1 py-3 text-center ${QUALITY_STYLE[chord.quality]}`}
          >
            <span className="font-serif text-sm text-neutral-500">{chord.numeral}</span>
            <span className="mt-1 text-lg font-semibold">
              <NoteName value={chord.name} />
            </span>
            <span className="mt-1 flex gap-1 text-xs text-neutral-500">
              {chord.notes.map((note) => (
                <span key={note}>
                  <NoteName value={note} />
                </span>
              ))}
            </span>
            <span className="sr-only">{chord.quality}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
