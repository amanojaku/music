import { NoteName } from "@/components/NoteName";
import { tuningOffsets, type Tuning } from "@/lib/music-theory";

/** Strip the octave: "F#3" → "F#". */
const pitchName = (note: string) => note.replace(/-?\d+$/, "");

function offsetLabel(semitones: number): string {
  const n = Math.abs(semitones);
  const size = n === 1 ? "a half step" : n === 2 ? "a whole step" : `${n} semitones`;
  return `${semitones > 0 ? "raised" : "lowered"} ${size}`;
}

export function TuningInfo({ tuning }: { tuning: Tuning }) {
  const strings = tuning;
  const offsets = tuningOffsets(strings);
  const isStandard = offsets.every((o) => o === 0);

  return (
    <section className="mt-10" aria-labelledby="tuning-heading">
      <h2 id="tuning-heading" className="text-sm font-medium tracking-wider text-neutral-500 uppercase">
        Tuning
      </h2>
      <p className="mt-1 flex gap-2 text-2xl font-semibold">
        {isStandard ? (
          "Standard"
        ) : (
          <>
            {strings.map((note, i) => (
              <span key={i}>
                <NoteName value={pitchName(note)} />
              </span>
            ))}
          </>
        )}
      </p>
      <ol className="mt-3 grid grid-cols-6 gap-2 sm:max-w-md" aria-label="Strings, low to high">
        {strings.map((note, i) => {
          const offset = offsets[i];
          return (
            <li
              key={i}
              className={`flex flex-col items-center rounded-lg border px-1 py-2 text-center ${
                offset ? "border-foreground" : "border-neutral-300 dark:border-neutral-700"
              }`}
            >
              <span className="text-xs text-neutral-500">{6 - i}</span>
              <span className="text-lg font-semibold">
                <NoteName value={pitchName(note)} />
              </span>
              <span className="h-4 text-xs text-neutral-500" aria-hidden>
                {offset > 0 ? `+${offset}` : offset < 0 ? `${offset}` : ""}
              </span>
              {offset !== 0 && <span className="sr-only">{offsetLabel(offset)}</span>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
