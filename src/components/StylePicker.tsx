"use client";

import { VISUAL_STYLES, type VisualStyleId } from "@/lib/visuals/styles";

const PICKER_OPTIONS: Array<{ id: VisualStyleId; label: string }> = [
  ...VISUAL_STYLES.map(({ id, label }) => ({ id: id as VisualStyleId, label })),
  { id: "off", label: "Off" },
];

type Props = { value: VisualStyleId; onChange: (id: VisualStyleId) => void; className?: string };

export function StylePicker({ value, onChange, className = "" }: Props) {
  return (
    <fieldset className={`flex flex-wrap items-center gap-2 text-sm ${className}`}>
      <legend className="sr-only">Visuals</legend>
      <span className="text-neutral-500" aria-hidden>
        Visuals
      </span>
      {PICKER_OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={`rounded-full border px-3 py-1 transition ${
            value === option.id
              ? "border-foreground bg-foreground text-background"
              : "border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
          }`}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  );
}
