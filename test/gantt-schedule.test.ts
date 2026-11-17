import {
  DEFAULT_DURATION_DAYS,
  GanttTaskInput,
  fillTimeline,
  getTimelineRange,
  isInferredBar,
  resizeBar,
  scheduleTasks,
  shiftBar,
} from "../src/lib/gantt-schedule";

const TODAY = "2026-08-06";

function makeInput(
  id: string,
  overrides: Partial<GanttTaskInput> = {}
): GanttTaskInput {
  return {
    id,
    incomingLinks: [],
    ...overrides,
  };
}

function schedule(tasks: GanttTaskInput[], today = TODAY) {
  return scheduleTasks(tasks, { today });
}

describe("scheduleTasks", () => {
  describe("explicit dates", () => {
    it("uses both dates as given", () => {
      const bars = schedule([
        makeInput("a", { start: "2026-08-10", due: "2026-08-14" }),
      ]);

      expect(bars.get("a")).toMatchObject({
        start: "2026-08-10",
        end: "2026-08-14",
        startInferred: false,
        endInferred: false,
      });
    });

    it("gives a start-only task the default duration", () => {
      const bars = schedule([makeInput("a", { start: "2026-08-10" })]);

      expect(bars.get("a")).toMatchObject({
        start: "2026-08-10",
        end: "2026-08-10",
        endInferred: true,
      });
      expect(DEFAULT_DURATION_DAYS).toBe(1);
    });

    it("treats a completion date as the bar end", () => {
      const bars = schedule([
        makeInput("a", { start: "2026-08-03", done: "2026-08-05" }),
      ]);

      expect(bars.get("a")).toMatchObject({
        start: "2026-08-03",
        end: "2026-08-05",
      });
    });

    it("collapses a bar whose due date precedes its start", () => {
      const bars = schedule([
        makeInput("a", { start: "2026-08-10", due: "2026-08-01" }),
      ]);

      expect(bars.get("a")).toMatchObject({
        start: "2026-08-10",
        end: "2026-08-10",
      });
    });
  });

  describe("undated tasks", () => {
    it("anchors a task with no dates and no blockers to today", () => {
      const bars = schedule([makeInput("a")]);

      expect(bars.get("a")).toMatchObject({
        start: TODAY,
        end: TODAY,
        startInferred: true,
        endInferred: true,
      });
      expect(isInferredBar(bars.get("a")!)).toBe(true);
    });

    it("starts the day after a dated blocker finishes", () => {
      const bars = schedule([
        makeInput("a", { start: "2026-08-10", due: "2026-08-12" }),
        makeInput("b", { incomingLinks: ["a"] }),
      ]);

      expect(bars.get("b")).toMatchObject({
        start: "2026-08-13",
        end: "2026-08-13",
      });
    });

    it("flows a chain of undated tasks one day at a time", () => {
      const bars = schedule([
        makeInput("a", { start: "2026-08-10", due: "2026-08-10" }),
        makeInput("b", { incomingLinks: ["a"] }),
        makeInput("c", { incomingLinks: ["b"] }),
        makeInput("d", { incomingLinks: ["c"] }),
      ]);

      expect(bars.get("b")?.start).toBe("2026-08-11");
      expect(bars.get("c")?.start).toBe("2026-08-12");
      expect(bars.get("d")?.start).toBe("2026-08-13");
    });

    it("waits for the latest of several blockers", () => {
      const bars = schedule([
        makeInput("early", { start: "2026-08-10", due: "2026-08-11" }),
        makeInput("late", { start: "2026-08-10", due: "2026-08-20" }),
        makeInput("after", { incomingLinks: ["early", "late"] }),
      ]);

      expect(bars.get("after")?.start).toBe("2026-08-21");
    });

    it("resolves blockers listed after their dependents", () => {
      const bars = schedule([
        makeInput("b", { incomingLinks: ["a"] }),
        makeInput("a", { start: "2026-09-01", due: "2026-09-02" }),
      ]);

      expect(bars.get("b")?.start).toBe("2026-09-03");
    });

    it("ignores blockers that are not in the task set", () => {
      const bars = schedule([makeInput("a", { incomingLinks: ["missing"] })]);

      expect(bars.get("a")?.start).toBe(TODAY);
    });
  });

  describe("due-only tasks", () => {
    it("spans from the blocker's finish to the deadline", () => {
      const bars = schedule([
        makeInput("a", { start: "2026-08-10", due: "2026-08-11" }),
        makeInput("b", { incomingLinks: ["a"], due: "2026-08-20" }),
      ]);

      expect(bars.get("b")).toMatchObject({
        start: "2026-08-12",
        end: "2026-08-20",
        startInferred: true,
        endInferred: false,
      });
    });

    it("falls back to a default-length bar when the deadline is already past", () => {
      const bars = schedule([
        makeInput("a", { start: "2026-08-10", due: "2026-08-30" }),
        makeInput("b", { incomingLinks: ["a"], due: "2026-08-12" }),
      ]);

      expect(bars.get("b")).toMatchObject({
        start: "2026-08-12",
        end: "2026-08-12",
      });
    });
  });

  describe("edge cases", () => {
    it("still schedules both tasks in a dependency cycle", () => {
      const bars = schedule([
        makeInput("a", { incomingLinks: ["b"] }),
        makeInput("b", { incomingLinks: ["a"] }),
      ]);

      expect(bars.size).toBe(2);
      expect(bars.get("a")?.start).toBeTruthy();
      expect(bars.get("b")?.start).toBeTruthy();
    });

    it("survives a task that blocks itself", () => {
      const bars = schedule([makeInput("a", { incomingLinks: ["a"] })]);

      expect(bars.get("a")?.start).toBe(TODAY);
    });

    it("ignores malformed dates and infers instead", () => {
      const bars = schedule([
        makeInput("a", { start: "not-a-date", due: "2026-02-31" }),
      ]);

      expect(bars.get("a")).toMatchObject({
        start: TODAY,
        startInferred: true,
        endInferred: true,
      });
    });

    it("returns an empty map for no tasks", () => {
      expect(schedule([]).size).toBe(0);
    });

    it("honours a longer default duration", () => {
      const bars = scheduleTasks([makeInput("a")], {
        today: TODAY,
        defaultDurationDays: 5,
      });

      expect(bars.get("a")).toMatchObject({
        start: "2026-08-06",
        end: "2026-08-10",
      });
    });
  });
});

describe("getTimelineRange", () => {
  it("pads around the bars", () => {
    const range = getTimelineRange(
      [
        {
          id: "a",
          start: "2026-08-10",
          end: "2026-08-12",
          startInferred: false,
          endInferred: false,
        },
      ],
      { today: "2026-08-11", padDays: 2 }
    );

    expect(range).toEqual({ start: "2026-08-08", end: "2026-08-14" });
  });

  it("stretches to keep today in view", () => {
    const range = getTimelineRange(
      [
        {
          id: "a",
          start: "2026-09-10",
          end: "2026-09-12",
          startInferred: false,
          endInferred: false,
        },
      ],
      { today: "2026-08-01", padDays: 1 }
    );

    expect(range.start).toBe("2026-07-31");
    expect(range.end).toBe("2026-09-13");
  });

  it("falls back to a window around today when there are no bars", () => {
    const range = getTimelineRange([], { today: TODAY, padDays: 3 });

    expect(range).toEqual({ start: "2026-08-03", end: "2026-08-09" });
  });

  it("stretches to reach an anchor beyond every bar", () => {
    const range = getTimelineRange(
      [
        {
          id: "a",
          start: "2026-08-10",
          end: "2026-08-12",
          startInferred: false,
          endInferred: false,
        },
      ],
      { today: "2026-08-11", padDays: 1, anchors: ["2026-09-30"] }
    );

    expect(range.end).toBe("2026-10-01");
  });

  it("covers an anchor even with no bars at all", () => {
    const range = getTimelineRange([], {
      today: TODAY,
      padDays: 1,
      anchors: ["2026-08-20"],
    });

    expect(range).toEqual({ start: "2026-08-05", end: "2026-08-21" });
  });

  it("ignores unparseable anchors", () => {
    const range = getTimelineRange([], {
      today: TODAY,
      padDays: 3,
      anchors: ["not a date"],
    });

    expect(range).toEqual({ start: "2026-08-03", end: "2026-08-09" });
  });
});

describe("shiftBar", () => {
  it("moves both ends, keeping the length", () => {
    expect(shiftBar({ start: "2026-08-10", end: "2026-08-12" }, 3)).toEqual({
      start: "2026-08-13",
      end: "2026-08-15",
    });
  });

  it("moves backwards across a month boundary", () => {
    expect(shiftBar({ start: "2026-09-01", end: "2026-09-02" }, -2)).toEqual({
      start: "2026-08-30",
      end: "2026-08-31",
    });
  });

  it("is a no-op for zero days", () => {
    expect(shiftBar({ start: "2026-08-10", end: "2026-08-12" }, 0)).toEqual({
      start: "2026-08-10",
      end: "2026-08-12",
    });
  });
});

describe("resizeBar", () => {
  it("drags the start edge", () => {
    expect(
      resizeBar({ start: "2026-08-10", end: "2026-08-14" }, "start", 2)
    ).toEqual({ start: "2026-08-12", end: "2026-08-14" });
  });

  it("drags the end edge", () => {
    expect(
      resizeBar({ start: "2026-08-10", end: "2026-08-14" }, "end", -2)
    ).toEqual({ start: "2026-08-10", end: "2026-08-12" });
  });

  it("never lets the start pass the end", () => {
    expect(
      resizeBar({ start: "2026-08-10", end: "2026-08-12" }, "start", 10)
    ).toEqual({ start: "2026-08-12", end: "2026-08-12" });
  });

  it("never lets the end pass the start", () => {
    expect(
      resizeBar({ start: "2026-08-10", end: "2026-08-12" }, "end", -10)
    ).toEqual({ start: "2026-08-10", end: "2026-08-10" });
  });
});

describe("working-day scheduling", () => {
  // 2026-08-07 is a Friday, 08-10 the Monday after
  it("ends a four-day task that starts on Friday on the Wednesday", () => {
    const bars = scheduleTasks([makeInput("a", { start: "2026-08-07" })], {
      today: TODAY,
      defaultDurationDays: 4,
      skipWeekends: true,
    });

    expect(bars.get("a")).toMatchObject({
      start: "2026-08-07",
      end: "2026-08-12",
    });
  });

  it("keeps calendar days when the toggle is off", () => {
    const bars = scheduleTasks([makeInput("a", { start: "2026-08-07" })], {
      today: TODAY,
      defaultDurationDays: 4,
    });

    expect(bars.get("a")?.end).toBe("2026-08-10");
  });

  it("starts a blocked task on the Monday when its blocker ends Friday", () => {
    const bars = scheduleTasks(
      [
        makeInput("a", { start: "2026-08-05", due: "2026-08-07" }),
        makeInput("b", { incomingLinks: ["a"] }),
      ],
      { today: TODAY, skipWeekends: true }
    );

    expect(bars.get("b")?.start).toBe("2026-08-10");
  });

  it("anchors an undated task to the next working day", () => {
    // 2026-08-08 is a Saturday
    const bars = scheduleTasks([makeInput("a")], {
      today: "2026-08-08",
      skipWeekends: true,
    });

    expect(bars.get("a")?.start).toBe("2026-08-10");
  });
});

describe("shiftBar with working days", () => {
  it("slides a bar dropped on a Saturday to the Monday", () => {
    const moved = shiftBar({ start: "2026-08-07", end: "2026-08-07" }, 1, true);
    expect(moved).toEqual({ start: "2026-08-10", end: "2026-08-10" });
  });

  it("keeps the working length when crossing a weekend", () => {
    // Thu-Fri, two working days, dragged one day on
    const moved = shiftBar({ start: "2026-08-06", end: "2026-08-07" }, 1, true);
    expect(moved).toEqual({ start: "2026-08-07", end: "2026-08-10" });
  });

  it("is unchanged when weekends are not skipped", () => {
    expect(shiftBar({ start: "2026-08-07", end: "2026-08-07" }, 1)).toEqual({
      start: "2026-08-08",
      end: "2026-08-08",
    });
  });
});

describe("resizeBar with working days", () => {
  it("lands an end dragged into the weekend on the Monday", () => {
    // Friday stretched by two days reaches Sunday, so it ends on the Monday
    const resized = resizeBar(
      { start: "2026-08-07", end: "2026-08-07" },
      "end",
      2,
      true
    );
    expect(resized).toEqual({ start: "2026-08-07", end: "2026-08-10" });
  });

  it("leaves an end that already falls on a weekday", () => {
    const resized = resizeBar(
      { start: "2026-08-10", end: "2026-08-10" },
      "end",
      2,
      true
    );
    expect(resized).toEqual({ start: "2026-08-10", end: "2026-08-12" });
  });

  it("moves a start dragged onto a weekend to the Monday", () => {
    const resized = resizeBar(
      { start: "2026-08-06", end: "2026-08-14" },
      "start",
      2,
      true
    );
    expect(resized).toEqual({ start: "2026-08-10", end: "2026-08-14" });
  });
});

describe("fillTimeline", () => {
  const range = { start: "2026-09-01", end: "2026-09-10" };

  it("runs a short timeline on to the minimum length", () => {
    expect(fillTimeline(range, 30)).toEqual({
      start: "2026-09-01",
      end: "2026-09-30",
    });
  });

  it("leaves a timeline that is already long enough alone", () => {
    expect(fillTimeline(range, 10)).toBe(range);
    expect(fillTimeline(range, 0)).toBe(range);
  });
});
