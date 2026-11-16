import { DEFAULT_COMPANION_FOLDER } from "./companion-note";
import { DEFAULT_RATE_NOTE_PATH } from "./rate-book-note";

/** Hours assumed for a working day when the entered value is unusable. */
export const DEFAULT_HOURS_PER_DAY = 8;

/**
 * Cleans up a value on its way into the settings object.
 *
 * Obsidian's declarative settings bind a control straight to a key, so a
 * cleared text box would otherwise store an empty string and a half-typed
 * number would store NaN. The imperative `display()` path did this inline in
 * each `onChange`; keeping it here means both paths agree and the rules are
 * testable without rendering a settings tab.
 *
 * Keys with no rule are returned untouched, which is the common case: a toggle
 * or a dropdown can only produce a value its own control offered.
 */
export function normalizeSettingValue(key: string, value: unknown): unknown {
  switch (key) {
    // A blank path means "I do not want to choose", not "store nothing".
    case "financeRateNotePath":
      return String(value ?? "").trim() || DEFAULT_RATE_NOTE_PATH;
    case "companionNoteFolder":
      return String(value ?? "").trim() || DEFAULT_COMPANION_FOLDER;

    // A day cannot be negative, and NaN here would poison every cost total.
    // Note `Number("")` and `Number(null)` are both 0, which would pass the
    // finite check and silently store a zero-hour day, so an empty box has to
    // be rejected before the conversion rather than after it.
    case "financeDefaultHoursPerDay": {
      const entered = typeof value === "string" ? value.trim() : value;
      if (entered === "" || entered === null || entered === undefined) {
        return DEFAULT_HOURS_PER_DAY;
      }
      const hours = Number(entered);
      return Number.isFinite(hours) && hours >= 0
        ? hours
        : DEFAULT_HOURS_PER_DAY;
    }

    // A negative corner radius is not a shape ReactFlow can draw.
    case "smoothStepRadius": {
      const radius = Number(value);
      return Number.isFinite(radius) ? Math.max(0, radius) : 0;
    }

    default:
      return value;
  }
}
