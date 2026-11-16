import {
  DEFAULT_GANTT_EMBED_CONFIG,
  parseGanttEmbed,
} from "../src/lib/gantt-embed";
import { EMPTY_TASK_SOURCE } from "../src/lib/task-source";

describe("parseGanttEmbed", () => {
  it("charts every task when the body is empty", () => {
    expect(parseGanttEmbed("  \n")).toEqual({
      kind: "ok",
      source: EMPTY_TASK_SOURCE,
      config: DEFAULT_GANTT_EMBED_CONFIG,
    });
  });

  it("reads the source and the height", () => {
    const result = parseGanttEmbed(
      JSON.stringify({
        source: { folders: ["Projects/Alpha"], tags: ["alpha"] },
        config: { height: 320 },
      })
    );
    expect(result).toEqual({
      kind: "ok",
      source: {
        ...EMPTY_TASK_SOURCE,
        folders: ["Projects/Alpha"],
        tags: ["alpha"],
      },
      config: { height: 320 },
    });
  });

  it("falls back to the default height for a bad one", () => {
    for (const height of [0, -5, "400", null]) {
      const result = parseGanttEmbed(JSON.stringify({ config: { height } }));
      if (result.kind !== "ok") throw new Error("expected ok");
      expect(result.config.height).toBe(DEFAULT_GANTT_EMBED_CONFIG.height);
    }
  });

  it("rejects a body that is not a JSON object", () => {
    expect(parseGanttEmbed("{ folders: [A] }").kind).toBe("invalid");
    expect(parseGanttEmbed("[]").kind).toBe("invalid");
    expect(parseGanttEmbed('"A"').kind).toBe("invalid");
  });
});
