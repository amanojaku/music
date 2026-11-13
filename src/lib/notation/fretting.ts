/**
 * Assign each note a string and fret for tab.
 *
 * For every chord (notes starting together) we enumerate the playable
 * fingerings in the given tuning, then choose the sequence across the whole
 * piece that minimises effort (Viterbi): small stretches, low frets, open
 * strings, and little movement of the fretting hand between events.
 */

export interface FrettedNote {
  pitch: number;
  /** MusicXML/tab convention: 1 = highest-pitched string … 6 = lowest. */
  string: number;
  fret: number;
}

export interface FrettingResult {
  events: FrettedNote[][];
  /** Notes that could not be placed (out of range, or more notes than strings). */
  dropped: number;
}

const MAX_FRET = 15;
const MAX_CANDIDATES = 24;

type Candidate = { notes: FrettedNote[]; cost: number; position: number | null };

/** All fingerings of `pitches` on distinct strings. `openMidi` is low → high. */
function fingerings(pitches: number[], openMidi: number[]): FrettedNote[][] {
  const results: FrettedNote[][] = [];
  const used = new Set<number>();
  const sorted = [...pitches].sort((a, b) => b - a);
  const current: FrettedNote[] = [];

  const visit = (i: number) => {
    if (results.length > 500) return;
    if (i === sorted.length) {
      results.push([...current]);
      return;
    }
    const pitch = sorted[i];
    openMidi.forEach((open, index) => {
      const fret = pitch - open;
      if (fret < 0 || fret > MAX_FRET || used.has(index)) return;
      used.add(index);
      current.push({ pitch, string: openMidi.length - index, fret });
      visit(i + 1);
      current.pop();
      used.delete(index);
    });
  };
  visit(0);
  return results;
}

function describe(notes: FrettedNote[]): Candidate {
  const fretted = notes.map((n) => n.fret).filter((f) => f > 0);
  const span = fretted.length > 1 ? Math.max(...fretted) - Math.min(...fretted) : 0;
  const position = fretted.length ? fretted.reduce((a, b) => a + b, 0) / fretted.length : null;
  let cost = span > 4 ? 50 + span * 5 : span * 1.5;
  cost += notes.reduce((sum, n) => sum + n.fret, 0) * 0.15;
  return { notes, cost, position };
}

/**
 * Candidates for one chord. If no fingering fits every note, drop the quietest
 * (by order given: callers pass loudest first) until one does.
 */
function candidatesFor(pitches: number[], openMidi: number[]): { candidates: Candidate[]; dropped: number } {
  const playable = [...new Set(pitches)].filter((p) => openMidi.some((open) => p >= open && p - open <= MAX_FRET));
  let dropped = pitches.length - playable.length;
  let chord = playable.slice(0, openMidi.length);
  dropped += playable.length - chord.length;
  while (chord.length) {
    const found = fingerings(chord, openMidi);
    if (found.length) {
      const candidates = found
        .map(describe)
        .sort((a, b) => a.cost - b.cost)
        .slice(0, MAX_CANDIDATES);
      return { candidates, dropped };
    }
    chord = chord.slice(0, -1);
    dropped++;
  }
  return { candidates: [{ notes: [], cost: 0, position: null }], dropped };
}

/**
 * @param chords Pitches per event, each list ordered loudest first.
 * @param openMidi Open-string MIDI notes, low → high (e.g. standard: 40 45 50 55 59 64).
 */
export function assignFrets(chords: number[][], openMidi: number[]): FrettingResult {
  let dropped = 0;
  const layers = chords.map((pitches) => {
    const result = candidatesFor(pitches, openMidi);
    dropped += result.dropped;
    return result.candidates;
  });
  if (!layers.length) return { events: [], dropped };

  // Viterbi over candidates; hand position carries forward through open-string-only events.
  type State = { total: number; prev: number; position: number };
  let states: State[] = layers[0].map((c) => ({ total: c.cost, prev: -1, position: c.position ?? 0 }));
  const history: State[][] = [states];

  for (let e = 1; e < layers.length; e++) {
    states = layers[e].map((c) => {
      let best: State = { total: Infinity, prev: -1, position: 0 };
      history[e - 1].forEach((p, i) => {
        const move = c.position === null ? 0 : Math.abs(c.position - p.position) * 0.8;
        const total = p.total + c.cost + move;
        if (total < best.total) best = { total, prev: i, position: c.position ?? p.position };
      });
      return best;
    });
    history.push(states);
  }

  let index = 0;
  states.forEach((s, i) => {
    if (s.total < states[index].total) index = i;
  });
  const events: FrettedNote[][] = new Array(layers.length);
  for (let e = layers.length - 1; e >= 0; e--) {
    events[e] = layers[e][index].notes;
    index = history[e][index].prev;
  }
  return { events, dropped };
}
