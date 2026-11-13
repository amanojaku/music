import { describe, expect, it } from "vitest";
import { diatonicTriads, keyName, prettyNote, scaleNotes, type Key } from "./music-theory";

const names = (key: Key) => diatonicTriads(key).map((c) => c.name);
const numerals = (key: Key) => diatonicTriads(key).map((c) => c.numeral);

describe("scaleNotes", () => {
  it.each([
    ["C", "major", "C D E F G A B"],
    ["G", "major", "G A B C D E F#"],
    ["D", "major", "D E F# G A B C#"],
    ["F", "major", "F G A Bb C D E"],
    ["Eb", "major", "Eb F G Ab Bb C D"],
    ["F#", "major", "F# G# A# B C# D# E#"],
    ["Gb", "major", "Gb Ab Bb Cb Db Eb F"],
    ["C#", "major", "C# D# E# F# G# A# B#"],
    ["Cb", "major", "Cb Db Eb Fb Gb Ab Bb"],
    ["A", "minor", "A B C D E F G"],
    ["E", "minor", "E F# G A B C D"],
    ["F#", "minor", "F# G# A B C# D E"],
    ["Bb", "minor", "Bb C Db Eb F Gb Ab"],
    ["D#", "minor", "D# E# F# G# A# B C#"],
    ["Ab", "minor", "Ab Bb Cb Db Eb Fb Gb"],
  ] as const)("%s %s", (tonic, mode, expected) => {
    expect(scaleNotes({ tonic, mode }).join(" ")).toBe(expected);
  });

  it("uses every letter exactly once in all 30 standard keys", () => {
    const majors = ["C", "G", "D", "A", "E", "B", "F#", "C#", "F", "Bb", "Eb", "Ab", "Db", "Gb", "Cb"] as const;
    const minors = ["A", "E", "B", "F#", "C#", "G#", "D#", "A#", "D", "G", "C", "F", "Bb", "Eb", "Ab"] as const;
    const keys: Key[] = [
      ...majors.map((tonic) => ({ tonic, mode: "major" as const })),
      ...minors.map((tonic) => ({ tonic, mode: "minor" as const })),
    ];
    for (const key of keys) {
      const letters = scaleNotes(key).map((n) => n[0]);
      expect(new Set(letters).size, keyName(key)).toBe(7);
    }
  });
});

describe("diatonicTriads", () => {
  it("G major", () => {
    expect(names({ tonic: "G", mode: "major" })).toEqual(["G", "Am", "Bm", "C", "D", "Em", "F#°"]);
    expect(numerals({ tonic: "G", mode: "major" })).toEqual(["I", "ii", "iii", "IV", "V", "vi", "vii°"]);
  });

  it("E natural minor", () => {
    expect(names({ tonic: "E", mode: "minor" })).toEqual(["Em", "F#°", "G", "Am", "Bm", "C", "D"]);
    expect(numerals({ tonic: "E", mode: "minor" })).toEqual(["i", "ii°", "III", "iv", "v", "VI", "VII"]);
  });

  it("Bb minor spells chords with flats", () => {
    expect(names({ tonic: "Bb", mode: "minor" })).toEqual(["Bbm", "C°", "Db", "Ebm", "Fm", "Gb", "Ab"]);
  });

  it("returns root, third and fifth", () => {
    const chords = diatonicTriads({ tonic: "D", mode: "major" });
    expect(chords[0].notes).toEqual(["D", "F#", "A"]);
    expect(chords[6].notes).toEqual(["C#", "E", "G"]);
    expect(chords[6].quality).toBe("diminished");
  });

  it("spells theoretical keys with double sharps", () => {
    expect(scaleNotes({ tonic: "G#", mode: "major" })).toEqual(["G#", "A#", "B#", "C#", "D#", "E#", "F##"]);
  });

  it("rejects invalid tonics", () => {
    expect(() => scaleNotes({ tonic: "H" as never, mode: "major" })).toThrow();
  });
});

describe("display", () => {
  it.each([
    ["F#", "F♯"],
    ["Bb", "B♭"],
    ["Bbm", "B♭m"],
    ["F#°", "F♯°"],
    ["F##", "F𝄪"],
    ["Bbb", "B𝄫"],
    ["Am", "Am"],
  ])("prettyNote(%s) = %s", (input, expected) => {
    expect(prettyNote(input)).toBe(expected);
  });

  it("keyName", () => {
    expect(keyName({ tonic: "Eb", mode: "major" })).toBe("E♭ major");
  });
});
