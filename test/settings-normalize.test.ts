import {
  DEFAULT_HOURS_PER_DAY,
  normalizeSettingValue,
} from "../src/lib/settings-normalize";
import { DEFAULT_COMPANION_FOLDER } from "../src/lib/companion-note";
import { DEFAULT_RATE_NOTE_PATH } from "../src/lib/rate-book-note";

describe("normalizeSettingValue", () => {
  describe("paths that must never be stored blank", () => {
    it.each([
      ["financeRateNotePath", DEFAULT_RATE_NOTE_PATH],
      ["companionNoteFolder", DEFAULT_COMPANION_FOLDER],
    ])("falls %s back to its default when cleared", (key, fallback) => {
      expect(normalizeSettingValue(key, "")).toBe(fallback);
      expect(normalizeSettingValue(key, "   ")).toBe(fallback);
      expect(normalizeSettingValue(key, undefined)).toBe(fallback);
      expect(normalizeSettingValue(key, null)).toBe(fallback);
    });

    it("trims whitespace around a real path", () => {
      expect(
        normalizeSettingValue("companionNoteFolder", "  Notes/Tasks ")
      ).toBe("Notes/Tasks");
    });

    it("keeps a path that is already clean", () => {
      expect(
        normalizeSettingValue("financeRateNotePath", "Admin/Rates.md")
      ).toBe("Admin/Rates.md");
    });
  });

  describe("financeDefaultHoursPerDay", () => {
    it("keeps a sensible number, fractions included", () => {
      expect(normalizeSettingValue("financeDefaultHoursPerDay", 7.5)).toBe(7.5);
      expect(normalizeSettingValue("financeDefaultHoursPerDay", 0)).toBe(0);
    });

    it("reads a number typed as text", () => {
      expect(normalizeSettingValue("financeDefaultHoursPerDay", "6")).toBe(6);
    });

    it.each([-1, NaN, Infinity, "", "abc", null, undefined])(
      "falls back for %p",
      (input) => {
        expect(normalizeSettingValue("financeDefaultHoursPerDay", input)).toBe(
          DEFAULT_HOURS_PER_DAY
        );
      }
    );
  });

  describe("smoothStepRadius", () => {
    it("keeps a non-negative radius", () => {
      expect(normalizeSettingValue("smoothStepRadius", 12)).toBe(12);
      expect(normalizeSettingValue("smoothStepRadius", 0)).toBe(0);
    });

    it("clamps a negative radius to zero rather than falling back", () => {
      expect(normalizeSettingValue("smoothStepRadius", -5)).toBe(0);
    });

    it.each([NaN, "abc", undefined])("reads %p as zero", (input) => {
      expect(normalizeSettingValue("smoothStepRadius", input)).toBe(0);
    });
  });

  describe("keys with no rule", () => {
    it("passes a toggle straight through", () => {
      expect(normalizeSettingValue("showTags", false)).toBe(false);
      expect(normalizeSettingValue("showTags", true)).toBe(true);
    });

    it("passes a dropdown choice straight through", () => {
      expect(normalizeSettingValue("edgeStyle", "SmoothStep")).toBe(
        "SmoothStep"
      );
    });

    it("does not trim a key it has no rule for", () => {
      expect(normalizeSettingValue("financeCurrency", " GBP ")).toBe(" GBP ");
    });
  });
});
