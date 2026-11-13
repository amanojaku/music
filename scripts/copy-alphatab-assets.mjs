// Copies alphaTab's music font (Bravura) into public/ so the notation view can load it.
import { cpSync, mkdirSync } from "node:fs";
import path from "node:path";

const src = path.join(process.cwd(), "node_modules/@coderline/alphatab/dist/font");
const dest = path.join(process.cwd(), "public/alphatab/font");
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log("copied alphaTab font to public/alphatab/font");
