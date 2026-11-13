"use client";

import { useCallback, useSyncExternalStore } from "react";
import { DEFAULT_STYLE, isVisualStyleId, type VisualStyleId } from "@/lib/visuals/styles";

/** Subscribe to a CSS media query. Returns `false` during SSR. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    useCallback(
      (onChange: () => void) => {
        const mql = window.matchMedia(query);
        mql.addEventListener("change", onChange);
        return () => mql.removeEventListener("change", onChange);
      },
      [query],
    ),
    () => window.matchMedia(query).matches,
    () => false,
  );
}

// ---- Visual style preference (per visitor, localStorage with in-memory fallback) ----

const STYLE_KEY = "visuals-style";
const styleListeners = new Set<() => void>();
let styleMemory: VisualStyleId | null = null;

function readStyle(): VisualStyleId {
  try {
    const stored = localStorage.getItem(STYLE_KEY);
    if (isVisualStyleId(stored)) return stored;
  } catch {
    // storage blocked (private mode etc.)
  }
  return styleMemory ?? DEFAULT_STYLE;
}

function subscribeStyle(onChange: () => void) {
  styleListeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    styleListeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useVisualStyle(): [VisualStyleId, (id: VisualStyleId) => void] {
  const value = useSyncExternalStore(subscribeStyle, readStyle, () => DEFAULT_STYLE);
  const set = useCallback((id: VisualStyleId) => {
    styleMemory = id;
    try {
      localStorage.setItem(STYLE_KEY, id);
    } catch {
      // fall back to memory only
    }
    styleListeners.forEach((l) => l());
  }, []);
  return [value, set];
}
