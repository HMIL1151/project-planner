import {
  EMPTY_TASK_SOURCE,
  buildDataviewSource,
  coerceTaskSource,
  combineSources,
} from "../src/lib/task-source";

describe("buildDataviewSource", () => {
  it("is empty when the spec names nothing, meaning the whole vault", () => {
    expect(buildDataviewSource(EMPTY_TASK_SOURCE)).toBe("");
  });

  it("quotes folders and files and joins every part with or", () => {
    expect(
      buildDataviewSource({
        ...EMPTY_TASK_SOURCE,
        folders: ["Projects/Alpha"],
        files: ["Work/plan.md"],
        tags: ["alpha"],
      })
    ).toBe('"Projects/Alpha" or "Work/plan.md" or #alpha');
  });

  it("drops a trailing slash on folders and a leading # on tags", () => {
    expect(
      buildDataviewSource({
        ...EMPTY_TASK_SOURCE,
        folders: ["Projects/Alpha/"],
        tags: ["#alpha"],
      })
    ).toBe('"Projects/Alpha" or #alpha');
  });

  it("skips blank entries", () => {
    expect(
      buildDataviewSource({
        ...EMPTY_TASK_SOURCE,
        folders: ["  ", ""],
        files: ["a.md"],
      })
    ).toBe('"a.md"');
  });

  it("escapes quotes inside a path", () => {
    expect(
      buildDataviewSource({ ...EMPTY_TASK_SOURCE, files: ['say "hi".md'] })
    ).toBe('"say \\"hi\\".md"');
  });

  it("uses a raw query as is when it stands alone", () => {
    expect(
      buildDataviewSource({ ...EMPTY_TASK_SOURCE, query: '"Work" and -#old' })
    ).toBe('"Work" and -#old');
  });

  it("brackets a raw query joined to other parts", () => {
    expect(
      buildDataviewSource({
        ...EMPTY_TASK_SOURCE,
        tags: ["alpha"],
        query: '"Work" and -#old',
      })
    ).toBe('#alpha or ("Work" and -#old)');
  });
});

describe("combineSources", () => {
  it("returns whichever side is set when the other is empty", () => {
    expect(combineSources("", "#alpha")).toBe("#alpha");
    expect(combineSources('-"Archive"', " ")).toBe('-"Archive"');
    expect(combineSources("", "")).toBe("");
  });

  it("requires both when both are set", () => {
    expect(combineSources('-"Archive"', '"A" or "B"')).toBe(
      '(-"Archive") and ("A" or "B")'
    );
  });
});

describe("coerceTaskSource", () => {
  it("reads every list and the raw query", () => {
    expect(
      coerceTaskSource({
        folders: ["A"],
        files: ["b.md"],
        tags: ["c"],
        query: "#d",
      })
    ).toEqual({ folders: ["A"], files: ["b.md"], tags: ["c"], query: "#d" });
  });

  it("takes a single string where a list was meant", () => {
    expect(coerceTaskSource({ folders: "A" }).folders).toEqual(["A"]);
  });

  it("takes a bare string as a raw Dataview source", () => {
    expect(coerceTaskSource('"A"')).toEqual({
      ...EMPTY_TASK_SOURCE,
      query: '"A"',
    });
  });

  it("ignores values of the wrong type", () => {
    expect(coerceTaskSource({ folders: [1, "A"], query: 3 })).toEqual({
      ...EMPTY_TASK_SOURCE,
      folders: ["A"],
    });
    expect(coerceTaskSource(null)).toEqual(EMPTY_TASK_SOURCE);
    expect(coerceTaskSource(["A"])).toEqual(EMPTY_TASK_SOURCE);
  });
});
