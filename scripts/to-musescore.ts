/**
 * Turn a track's draft MusicXML into a MuseScore 4 file with standard notation
 * and a LINKED tab staff in the track's tuning: edit either staff and the other
 * follows. Requires MuseScore 4 (uses its command-line converter).
 *
 *   npm run musescore -- <slug>
 *
 * Reads public/notation/<slug>/score.musicxml, writes public/notation/<slug>/<slug>.mscz
 * and a page-1 preview PNG. When you're done editing, export MusicXML from
 * MuseScore over score.musicxml (keep the bar count the same so sync points still fit).
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { findTrack } from "./track-data";
import { noteToMidi, STANDARD_TUNING } from "../src/lib/music-theory";

const MSCORE = process.env.MSCORE ?? "/Applications/MuseScore 4.app/Contents/MacOS/mscore";


/** MuseScore element ids look like "jPCKk25BoXK_G4ixtGRMH1C". */
const newEid = () => {
  const b64 = () => randomBytes(9).toString("base64").replace(/=/g, "").slice(0, 11);
  return `${b64()}_${b64()}`;
};

const mscore = (...args: string[]) => execFileSync(MSCORE, args, { stdio: ["ignore", "pipe", "pipe"] });

/** Replace string-number fingerings (from MusicXML <technical><string>) with real tab data. */
function addFretData(body: string, tuningHighToLow: number[]): { body: string; placed: number } {
  let placed = 0;
  const out = body.replace(/<Note>([\s\S]*?)<\/Note>/g, (note, inner: string) => {
    const fingering = /\s*<Fingering>\s*<eid>[^<]*<\/eid>\s*<style>string_number<\/style>\s*<text>(\d+)<\/text>\s*<\/Fingering>/.exec(inner);
    const pitch = /<pitch>(\d+)<\/pitch>/.exec(inner);
    if (!fingering || !pitch) return note;
    const string = Number(fingering[1]) - 1; // MuseScore: 0 = highest string
    const fret = Number(pitch[1]) - tuningHighToLow[string];
    if (fret < 0) return note;
    placed++;
    const cleaned = inner.replace(fingering[0], "");
    return `<Note>${cleaned.replace(/(<tpc>-?\d+<\/tpc>)/, `$1\n              <fret>${fret}</fret>\n              <string>${string}</string>`)}</Note>`;
  });
  return { body: out, placed };
}

/**
 * Copy of the notation staff's body for the linked tab staff: every element gets
 * a fresh id plus <linkedTo> its twin (as MuseScore writes linked staves).
 * Titles, tempo and clefs belong to the notation staff only.
 */
function linkedCopy(staffBody: string): string {
  const UNLINKED = "__unlinked__";
  return staffBody
    .replace(/\s*<VBox>[\s\S]*?<\/VBox>/g, "")
    .replace(/\s*<Tempo>[\s\S]*?<\/Tempo>/g, "")
    .replace(/\s*<Clef>[\s\S]*?<\/Clef>/g, "")
    .replace(/(<Measure>)\s*<eid>[^<]*<\/eid>/g, "$1")
    .replace(/(<(?:KeySig|TimeSig)>\s*)<eid>[^<]*<\/eid>/g, `$1<eid>${UNLINKED}</eid>`)
    .replace(/(\n\s*)<eid>([^<]*)<\/eid>/g, (_m, lead: string, eid: string) =>
      eid === UNLINKED
        ? `${lead}<eid>${newEid()}</eid>`
        : `${lead}<eid>${newEid()}</eid>${lead}<linkedTo>${eid}</linkedTo>`,
    );
}

function tabStaffDef(linkedTo: string): string {
  return `      <Staff>
        <eid>${newEid()}</eid>
        <linkedTo>${linkedTo}</linkedTo>
        <StaffType group="tablature">
          <name>tab6StrCommon</name>
          <lines>6</lines>
          <lineDistance>1.5</lineDistance>
          <timesig>0</timesig>
          <durations>0</durations>
          <fretUseTextStyle>1</fretUseTextStyle>
          <fretTextStyle>tab_fret_number</fretTextStyle>
          <linesThrough>0</linesThrough>
          <onLines>1</onLines>
          <showRests>0</showRests>
          <stemless>1</stemless>
          <upsideDown>0</upsideDown>
          <useNumbers>1</useNumbers>
          </StaffType>
        <defaultClef>G8vb</defaultClef>
        </Staff>`;
}

function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("Usage: npm run musescore -- <slug>");
    process.exit(1);
  }
  if (!existsSync(MSCORE)) throw new Error(`MuseScore not found at ${MSCORE} (set MSCORE to override)`);
  const { track } = findTrack(slug);
  const dir = path.join(process.cwd(), "public/notation", slug);
  const source = path.join(dir, "score.musicxml");
  if (!existsSync(source)) throw new Error(`No ${path.relative(process.cwd(), source)} — run npm run transcribe first`);

  const tuning = (track.tuning ?? STANDARD_TUNING).map(noteToMidi); // low → high
  const tmp = mkdtempSync(path.join(tmpdir(), "musescore-"));
  const converted = path.join(tmp, "converted.mscx");
  mscore("-o", converted, source);
  let mscx = readFileSync(converted, "utf8");

  // Part: notation staff + linked tab staff, and the guitar's real tuning.
  const staffDef = /(<Part id="1">\s*)(<Staff>[\s\S]*?<\/Staff>)/.exec(mscx);
  if (!staffDef) throw new Error("Unexpected MuseScore output: no part staff");
  const mainEid = /<eid>([^<]+)<\/eid>/.exec(staffDef[2])![1];
  const notationDef = staffDef[2].replace(/(<\/StaffType>)/, "$1\n        <defaultClef>G8vb</defaultClef>");
  mscx = mscx.replace(staffDef[0], `${staffDef[1]}${notationDef}\n${tabStaffDef(mainEid)}`);
  const stringData = `        <StringData>
          <frets>19</frets>
${tuning.map((m) => `          <string>${m}</string>`).join("\n")}
          </StringData>
        </Instrument>`;
  mscx = mscx.replace(/\s*<StringData>[\s\S]*?<\/StringData>/, "").replace(/\s*<\/Instrument>/, `\n${stringData}`);

  // Body: real fret/string on every note, then a linked copy for the tab staff.
  // The single body staff runs to the last </Staff> before </Score>.
  const staffBody = /<Staff id="1">([\s\S]*)\n(\s*)<\/Staff>(\s*<\/Score>)/.exec(mscx);
  if (!staffBody) throw new Error("Unexpected MuseScore output: no staff body");
  const [whole, inner, indent, scoreEnd] = staffBody;
  const { body, placed } = addFretData(inner, [...tuning].reverse());
  mscx = mscx.replace(
    whole,
    `<Staff id="1">${body}\n${indent}</Staff>\n${indent}<Staff id="2">${linkedCopy(body)}\n${indent}</Staff>${scoreEnd}`,
  );

  const patched = path.join(tmp, `${slug}.mscx`);
  writeFileSync(patched, mscx);
  const out = path.join(dir, `${slug}.mscz`);
  mscore("-o", out, patched); // round-trip through MuseScore so the file is saved in its canonical form
  // PNG export writes one file per page (<name>-1.png …); keep page 1 as the preview.
  mscore("-o", path.join(tmp, "page.png"), "-T", "10", out);
  copyFileSync(path.join(tmp, "page-1.png"), path.join(dir, `${slug}-preview.png`));
  rmSync(tmp, { recursive: true, force: true });

  const notes = (body.match(/<Note>/g) ?? []).length;
  console.log(`Wrote ${path.relative(process.cwd(), out)} (${placed}/${notes} notes with tab positions)`);
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
