import type { StyleDefinition } from "../types";
import { bloom } from "./bloom";
import { particles } from "./particles";
import { strings } from "./strings";

export const VISUAL_STYLES: StyleDefinition[] = [strings, bloom, particles];

export type VisualStyleId = "strings" | "bloom" | "particles" | "off";

export const DEFAULT_STYLE: VisualStyleId = "strings";

export function isVisualStyleId(value: unknown): value is VisualStyleId {
  return value === "off" || VISUAL_STYLES.some((s) => s.id === value);
}
