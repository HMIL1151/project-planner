import {
  GANTT_DAY_WIDTHS,
  MAX_FIT_DAY_WIDTH,
  MIN_FIT_DAY_WIDTH,
  buildHeaderTicks,
  buildSpans,
  fitDayWidth,
  headerLayout,
  isGanttScaleId,
  periodStart,
  quarterOf,
  resolveDayWidth,
} from "../src/lib/gantt-scale";

describe("isGanttScaleId", () => {
  it("accepts the fixed, window and fit scales", () => {
    for (const id of ["days", "weeks", "months", "2m", "6m", "18m", "fit"]) {
      expect(isGanttScaleId(id)).toBe(true);
    }
  });

  it("rejects anything else", () => {
    for (const id of ["years", "5m", "", 6, null, "toString"]) {
      expect(isGanttScaleId(id)).toBe(false);
    }
  });
});

describe("resolveDayWidth", () => {
  const room = { availablePx: 1216, totalDays: 900 };

  it("uses the fixed width for a fixed scale", () => {
    expect(resolveDayWidth("weeks", room)).toBe(GANTT_DAY_WIDTHS.weeks);
  });

  it("fits the whole plan for fit", () => {
    expect(resolveDayWidth("fit", room)).toBeCloseTo(1200 / 900);
  });

  it("fits that many months for a window scale", () => {
    // 12 months is 365.25 days
    expect(resolveDayWidth("12m", room)).toBeCloseTo(1200 / 365.25);
    expect(resolveDayWidth("6m", room)).toBeCloseTo((2 * 1200) / 365.25);
  });
});

describe("fitDayWidth", () => {
  it("caps a short plan at day resolution", () => {
    expect(fitDayWidth(2000, 5)).toBe(MAX_FIT_DAY_WIDTH);
  });

  it("keeps a very long plan above the floor", () => {
    expect(fitDayWidth(400, 100000)).toBe(MIN_FIT_DAY_WIDTH);
  });

  it("falls back to months before the chart has been measured", () => {
    expect(fitDayWidth(0, 900)).toBe(GANTT_DAY_WIDTHS.months);
  });
});

describe("headerLayout", () => {
  it("coarsens the header as days narrow", () => {
    expect(headerLayout(32).tick).toBe("day");
    expect(headerLayout(12).tick).toBe("week");
    expect(headerLayout(5).tick).toBe("week");
    expect(headerLayout(2)).toMatchObject({ band: "quarter", tick: "month" });
    expect(headerLayout(0.6)).toMatchObject({ band: "year", tick: "quarter" });
  });

  it("shades weekends only at day resolution", () => {
    expect(headerLayout(32).shadeWeekends).toBe(true);
    expect(headerLayout(12).shadeWeekends).toBe(false);
  });
});

describe("periodStart", () => {
  it("finds the Monday of a week", () => {
    // 2026-10-13 is a Tuesday, 2026-10-18 a Sunday
    expect(periodStart("2026-10-13", "week")).toBe("2026-10-12");
    expect(periodStart("2026-10-18", "week")).toBe("2026-10-12");
    expect(periodStart("2026-10-12", "week")).toBe("2026-10-12");
  });

  it("finds the first day of a month, quarter and year", () => {
    expect(periodStart("2026-11-20", "month")).toBe("2026-11-01");
    expect(periodStart("2026-11-20", "quarter")).toBe("2026-10-01");
    expect(periodStart("2027-03-31", "quarter")).toBe("2027-01-01");
    expect(periodStart("2026-11-20", "year")).toBe("2026-01-01");
  });

  it("numbers quarters from one", () => {
    expect(quarterOf("2026-01-01")).toBe(1);
    expect(quarterOf("2026-06-30")).toBe(2);
    expect(quarterOf("2026-12-31")).toBe(4);
  });
});

describe("buildSpans", () => {
  it("cuts the first and last period to the timeline", () => {
    expect(buildSpans("2026-10-20", 50, "month")).toEqual([
      { iso: "2026-10-20", offset: 0, days: 12 },
      { iso: "2026-11-01", offset: 12, days: 30 },
      { iso: "2026-12-01", offset: 42, days: 8 },
    ]);
  });

  it("covers every day exactly once", () => {
    const spans = buildSpans("2026-10-07", 900, "quarter");
    expect(spans.reduce((sum, span) => sum + span.days, 0)).toBe(900);
    expect(spans[1]).toEqual({ iso: "2027-01-01", offset: 86, days: 90 });
  });
});

describe("buildHeaderTicks", () => {
  it("marks a tick that opens a band as major", () => {
    const ticks = buildHeaderTicks("2026-12-01", 120, 2);
    // Month ticks under quarter bands: January opens Q1
    expect(ticks.map((tick) => [tick.iso, tick.major])).toEqual([
      ["2026-12-01", false],
      ["2027-01-01", true],
      ["2027-02-01", false],
      ["2027-03-01", false],
    ]);
  });

  it("leaves a sliver too narrow for its label unlabelled", () => {
    const ticks = buildHeaderTicks("2026-10-31", 40, 8);
    // A Saturday start leaves a two-day first week, 16px wide
    expect(ticks[0]).toMatchObject({ days: 2, labelled: false });
    expect(ticks[1]).toMatchObject({ iso: "2026-11-02", labelled: true });
  });

  it("leaves weeks unlabelled at the months scale, where they are 35px", () => {
    const ticks = buildHeaderTicks("2026-11-02", 28, 5);
    expect(ticks.every((tick) => !tick.labelled)).toBe(true);
  });

  it("flags weekend days at day resolution", () => {
    const ticks = buildHeaderTicks("2026-10-16", 3, 32);
    expect(ticks.map((tick) => tick.weekend)).toEqual([false, true, true]);
  });
});
