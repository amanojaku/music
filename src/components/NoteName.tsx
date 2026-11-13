/**
 * Renders a note or chord name ("F#", "Bbm", "C##°") with proper accidentals.
 *
 * Accidentals are inline SVG rather than Unicode ♯/♭: most UI fonts lack those
 * glyphs, and the fallback/music fonts have metrics that sit badly next to text.
 * SVG sized in `em` scales with the surrounding text and inherits its colour.
 */

type Accidental = "#" | "b" | "##" | "bb";

const LABELS: Record<Accidental, string> = { "#": "sharp", b: "flat", "##": "double sharp", bb: "double flat" };

function Sharp() {
  return (
    <svg viewBox="0 0 12 24" className="inline-block h-[0.85em] w-auto align-[-0.12em]" aria-hidden>
      <g stroke="currentColor" fill="none">
        <path d="M4.2 3.5v19M7.8 1.5v19" strokeWidth="1.3" />
        <path d="M1.5 10 10.5 7M1.5 17l9-3" strokeWidth="2.6" />
      </g>
    </svg>
  );
}

function Flat({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 10 24" className={`inline-block h-[0.8em] w-auto align-[-0.02em] ${className}`} aria-hidden>
      <path
        d="M2 1v22c4.5-2.6 7-5.2 7-7.8 0-2.2-1.6-3.4-3.4-3.4-1.4 0-2.6.7-3.6 1.8"
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DoubleSharp() {
  return (
    <svg viewBox="0 0 12 12" className="inline-block h-[0.45em] w-auto align-[0.05em]" aria-hidden>
      <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M0 0h4v4H0zM8 0h4v4H8zM0 8h4v4H0zM8 8h4v4H8z" fill="currentColor" />
    </svg>
  );
}

function AccidentalGlyph({ type }: { type: Accidental }) {
  switch (type) {
    case "#":
      return <Sharp />;
    case "b":
      return <Flat />;
    case "##":
      return <DoubleSharp />;
    case "bb":
      return (
        <>
          <Flat />
          <Flat className="-ml-[0.08em]" />
        </>
      );
  }
}

export function NoteName({ value }: { value: string }) {
  const match = /^([A-G])(##|bb|#|b)?(.*)$/.exec(value);
  if (!match) return <>{value}</>;
  const [, letter, accidental, rest] = match as unknown as [string, string, Accidental | undefined, string];
  return (
    <span className="whitespace-nowrap">
      {letter}
      {accidental && (
        <span className="ml-[0.04em] mr-[0.02em]">
          <AccidentalGlyph type={accidental} />
          <span className="sr-only"> {LABELS[accidental]} </span>
        </span>
      )}
      {rest}
    </span>
  );
}
