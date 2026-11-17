import { gateTasksByTag, parseTaskTags } from "../src/lib/task-tag-gate";
import { RawTask } from "../src/types/task";

const line = (text: string, path = "Notes/Daily.md"): RawTask => ({
  status: " ",
  text,
  link: { path },
});

describe("parseTaskTags", () => {
  it("reads a comma-separated list", () => {
    expect(parseTaskTags("#task, #project")).toEqual(["task", "project"]);
  });

  it("reads a whitespace-separated list", () => {
    expect(parseTaskTags("task project")).toEqual(["task", "project"]);
  });

  it("does not mind a mixture, or stray separators", () => {
    expect(parseTaskTags(" #task ,, #work   #admin,")).toEqual([
      "task",
      "work",
      "admin",
    ]);
  });

  it("strips any number of leading hashes", () => {
    expect(parseTaskTags("##task")).toEqual(["task"]);
  });

  it("drops duplicates, so the gate does not check the same tag twice", () => {
    expect(parseTaskTags("task, #task, TASK")).toEqual(["task", "TASK"]);
  });

  it("returns nothing for an empty or blank input", () => {
    expect(parseTaskTags("")).toEqual([]);
    expect(parseTaskTags("   ")).toEqual([]);
    expect(parseTaskTags(",, ,")).toEqual([]);
  });
});

describe("gateTasksByTag", () => {
  const tasks = [
    line("Write the report #task"),
    line("Milk and bread"),
    line("Call the site #task #urgent"),
    line("Draft the spec #project/alpha"),
    line("Tidy the garage #home"),
  ];

  describe("when no tags are required", () => {
    it("returns every line untouched, which is the default", () => {
      expect(gateTasksByTag(tasks, [])).toBe(tasks);
    });

    it("treats blank entries as no requirement at all", () => {
      expect(gateTasksByTag(tasks, ["", "  ", "#"])).toBe(tasks);
    });
  });

  describe("when one tag is required", () => {
    it("keeps only the lines carrying it", () => {
      const kept = gateTasksByTag(tasks, ["task"]).map((t) => t.text);
      expect(kept).toEqual([
        "Write the report #task",
        "Call the site #task #urgent",
      ]);
    });

    it("drops an untagged line, which is the whole request", () => {
      const kept = gateTasksByTag(tasks, ["task"]).map((t) => t.text);
      expect(kept).not.toContain("Milk and bread");
    });

    it("accepts the tag written with a hash", () => {
      expect(gateTasksByTag(tasks, ["#task"])).toHaveLength(2);
    });

    it("ignores case, because Obsidian's tag search does", () => {
      expect(gateTasksByTag([line("A job #Task")], ["task"])).toHaveLength(1);
      expect(gateTasksByTag([line("A job #task")], ["TASK"])).toHaveLength(1);
    });
  });

  describe("when several tags are required", () => {
    it("keeps a line carrying any one of them, not all", () => {
      const kept = gateTasksByTag(tasks, ["task", "home"]).map((t) => t.text);
      expect(kept).toHaveLength(3);
      expect(kept).toContain("Tidy the garage #home");
    });
  });

  describe("nested tags", () => {
    it("matches a child tag against its parent", () => {
      expect(gateTasksByTag(tasks, ["project"])).toHaveLength(1);
    });

    it("matches a child tag exactly too", () => {
      expect(gateTasksByTag(tasks, ["project/alpha"])).toHaveLength(1);
    });

    it("does not match a different child", () => {
      expect(gateTasksByTag(tasks, ["project/beta"])).toHaveLength(0);
    });

    it("does not match a tag that merely starts with the same letters", () => {
      expect(gateTasksByTag([line("Nope #taskmaster")], ["task"])).toHaveLength(
        0
      );
    });
  });

  describe("edge cases", () => {
    it("requires the hash, so a bare word is not a tag", () => {
      expect(gateTasksByTag([line("about task planning")], ["task"])).toEqual(
        []
      );
    });

    it("needs the tag at a word boundary, not mid-word", () => {
      expect(gateTasksByTag([line("email a#task now")], ["task"])).toEqual([]);
    });

    it("matches a tag at the very start of a line", () => {
      expect(gateTasksByTag([line("#task do it")], ["task"])).toHaveLength(1);
    });

    it("survives a line with no text", () => {
      expect(gateTasksByTag([line("")], ["task"])).toEqual([]);
    });

    it("returns an empty list rather than throwing on no input", () => {
      expect(gateTasksByTag([], ["task"])).toEqual([]);
    });
  });
});
