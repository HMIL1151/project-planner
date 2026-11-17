/**
 * Pins `docs/getting-started/agent-task-files.md` to the parser it describes.
 *
 * That page is handed to agents as the authoritative syntax for a generated
 * task file, so a claim in it that stops being true is worse than a missing
 * one: the agent writes a file that looks right, loads without complaint and
 * is quietly wrong. Every assertion here is a sentence in that document —
 * change a regex and whichever claim it breaks fails by name.
 *
 * Several of these pin failure modes rather than features: an out-of-charset
 * ID falling back to a random one, a cost entry with no amount being dropped,
 * the emoji dependency form breaking on a space. Those are the sentences the
 * document most needs to keep honest.
 */
import { TaskFactory } from "../src/lib/task-factory";
import { RawTask } from "../src/types/task";
import { getTaskProgress } from "../src/lib/task-progress";
import { parseRateBook } from "../src/lib/rate-book";
import { scanOpenQuestions } from "../src/lib/open-question";
import { gateTasksByTag, parseTaskTags } from "../src/lib/task-tag-gate";

const factory = new TaskFactory();

function parse(text: string, status = " ") {
  const raw: RawTask = { status, text, link: { path: "plan.md" } };
  return factory.parse(raw);
}

describe("TASK-FILE-SPEC claims", () => {
  it("parses a full worked-example line", () => {
    const t = parse(
      "Install on line 3 #northgate [id:: ng-install] [dependsOn:: ng-build, ng-order-steel] [owner:: Bob Jones] [hours:: 72] [people:: Bob Jones 50%, Cara Diaz 50%] [costs:: Access platform hire 640, Travel 420] 🛫 2027-03-29 📅 2027-04-02 🔺"
    );
    expect(t.id).toBe("ng-install");
    expect(t.incomingLinks.sort()).toEqual(["ng-build", "ng-order-steel"]);
    expect(t.owner).toBe("Bob Jones");
    expect(t.finance.totalHours).toBe(72);
    expect(t.finance.allocations).toEqual([
      { person: "Bob Jones", share: 0.5 },
      { person: "Cara Diaz", share: 0.5 },
    ]);
    expect(t.finance.expenses).toEqual([
      { description: "Access platform hire", amount: 640 },
      { description: "Travel", amount: 420 },
    ]);
    expect(t.dates).toEqual([
      { type: "due", date: "2027-04-02" },
      { type: "start", date: "2027-03-29" },
    ]);
    expect(t.tags).toEqual(["northgate"]);
    expect(t.priority).toBe("🔺");
    expect(t.summary).toBe("Install on line 3");
  });

  it("keeps a comma inside a number as one cost entry, and splits on semicolon", () => {
    const t = parse(
      "Order [id:: a1] [costs:: Cameras and lenses 9,600; Lighting 1,450]"
    );
    expect(t.finance.expenses).toEqual([
      { description: "Cameras and lenses", amount: 9600 },
      { description: "Lighting", amount: 1450 },
    ]);
  });

  it("drops a cost entry with no amount", () => {
    const t = parse("X [id:: a2] [costs:: Commissioning support, Travel 85]");
    expect(t.finance.expenses).toEqual([{ description: "Travel", amount: 85 }]);
  });

  it("reads a bare name as 100 percent", () => {
    const t = parse("X [id:: a3] [people:: Alice Smith]");
    expect(t.finance.allocations).toEqual([
      { person: "Alice Smith", share: 1 },
    ]);
  });

  it("treats 60%, 60 and 0.6 alike", () => {
    expect(
      parse("X [id:: a4] [people:: A 60%, B 60, C 0.6]").finance.allocations
    ).toEqual([
      { person: "A", share: 0.6 },
      { person: "B", share: 0.6 },
      { person: "C", share: 0.6 },
    ]);
  });

  it("parses hoursPerDay and lets hours win", () => {
    const t = parse("X [id:: a5] [hours:: 12] [hoursPerDay:: 6]");
    expect(t.finance.totalHours).toBe(12);
    expect(t.finance.hoursPerDay).toBe(6);
  });

  it("reads parent off the child", () => {
    expect(parse("X [id:: kid] [parent:: ng-design]").parentId).toBe(
      "ng-design"
    );
  });

  it("accepts a wiki-linked owner", () => {
    expect(parse("X [id:: a6] [owner:: [[Alice Smith]]]").owner).toBe(
      "Alice Smith"
    );
  });

  it("maps the four checkbox states", () => {
    expect(parse("X [id:: s1]", " ").status).toBe("todo");
    expect(parse("X [id:: s2]", "/").status).toBe("in_progress");
    expect(parse("X [id:: s3]", "x").status).toBe("done");
    expect(parse("X [id:: s4]", "-").status).toBe("canceled");
    expect(parse("X [id:: s5]", "X").status).toBe("todo"); // capital X NOT done
  });

  it("only reads a bare number as progress", () => {
    expect(getTaskProgress("X [progress:: 40]").percent).toBe(40);
    expect(getTaskProgress("X [progress:: 40%]").percent).toBe(40);
    expect(getTaskProgress("X [progress:: nearly done]").percent).toBeNull();
  });

  it("generates an unstable id when none is given", () => {
    const a = parse("No id here").id;
    const b = parse("No id here").id;
    expect(a).not.toBe(b);
  });

  it("ignores a bracketed id with an out-of-charset character entirely", () => {
    // Not "captures ng" — the whole field fails to match and a random id is
    // generated instead, so the id is unstable run to run.
    const a = parse("X [id:: ng.survey]").id;
    const b = parse("X [id:: ng.survey]").id;
    expect(a).not.toBe("ng");
    expect(a).not.toBe("ng.survey");
    expect(a).not.toBe(b);

    const c = parse("X [id:: ng survey]").id;
    expect(c).not.toBe("ng");
    expect(c).not.toBe(parse("X [id:: ng survey]").id);

    // The emoji form has no terminator, so it does truncate at the bad char
    expect(parse("X 🆔 ng.survey").id).toBe("ng");
  });

  it("eats the word after a stray emoji in the description", () => {
    expect(parse("Review 🎯 targets [id:: e1]").summary).toBe("Review");
  });

  it("ignores a non-ISO date", () => {
    expect(parse("X [id:: d1] 📅 12/01/2027").dates).toEqual([]);
  });

  it("breaks the emoji CSV form on a space after the comma", () => {
    expect(parse("X [id:: c1] ⛔ ng-a, ng-b").incomingLinks).toEqual(["ng-a"]);
    expect(
      parse("X [id:: c2] [dependsOn:: ng-a, ng-b]").incomingLinks.sort()
    ).toEqual(["ng-a", "ng-b"]);
  });

  it("reads the rate tables from the spec example", () => {
    const book = parseRateBook(
      [
        "# Rates",
        "",
        "| Grade     | Rate |",
        "| --------- | ---- |",
        "| Principal | 145  |",
        "| Senior    | 110  |",
        "| Engineer  | 85   |",
        "",
        "# People",
        "",
        "| Person      | Grade     | Rate |",
        "| ----------- | --------- | ---- |",
        "| Alice Smith | Principal |      |",
        "| Bob Jones   | Engineer  |      |",
        "| Cara Diaz   | Senior    | 130  |",
      ].join("\n")
    );
    expect(book.problems).toEqual([]);
    expect(book.grades).toEqual([
      { name: "Principal", rate: 145 },
      { name: "Senior", rate: 110 },
      { name: "Engineer", rate: 85 },
    ]);
    expect(book.people).toEqual([
      { name: "Alice Smith", grade: "Principal", rateOverride: null },
      { name: "Bob Jones", grade: "Engineer", rateOverride: null },
      { name: "Cara Diaz", grade: "Senior", rateOverride: 130 },
    ]);
  });

  it("reads an open question on its own line but not on a task line", () => {
    const questions = scanOpenQuestions(
      [
        "[oq:: When does week 1 begin?]",
        "> [!answer] 5 January 2027.",
        "- [ ] A task [oq:: ignored here]",
      ].join("\n"),
      "plan.md"
    );
    expect(questions).toHaveLength(1);
    expect(questions[0].question).toBe("When does week 1 begin?");
    expect(questions[0].answer).toBe("5 January 2027.");
  });
});

/**
 * The page tells the agent to put the same project tag on every task, because
 * a vault with required task tags set drops any line that carries none. These
 * pin the gate rules the page states, so neither drifts from the other.
 */
describe("TASK-FILE-SPEC claims about the task tag gate", () => {
  const line = (text: string): RawTask => ({
    status: " ",
    text,
    link: { path: "plan.md" },
  });

  it("lets every line through when no tags are required", () => {
    const tasks = [line("Untagged task"), line("Tagged #northgate")];
    expect(gateTasksByTag(tasks, [])).toHaveLength(2);
  });

  it("needs only one of the required tags, not all of them", () => {
    const tasks = [
      line("Has one #northgate"),
      line("Has the other #client"),
      line("Has both #northgate #client"),
      line("Has neither #admin"),
    ];
    const kept = gateTasksByTag(tasks, ["northgate", "client"]);
    expect(kept.map((task) => task.text)).toEqual([
      "Has one #northgate",
      "Has the other #client",
      "Has both #northgate #client",
    ]);
  });

  it("ignores case and a leading hash on the requirement", () => {
    const tasks = [line("Task #NorthGate")];
    expect(gateTasksByTag(tasks, ["#northgate"])).toHaveLength(1);
  });

  it("treats a nested tag as satisfying its parent", () => {
    const tasks = [line("Task #project/alpha")];
    expect(gateTasksByTag(tasks, ["project"])).toHaveLength(1);
    // but not the other way round
    expect(gateTasksByTag([line("Task #project")], ["project/alpha"])).toEqual(
      []
    );
  });

  it("drops an untagged task when a tag is required", () => {
    expect(gateTasksByTag([line("No tag at all")], ["northgate"])).toEqual([]);
  });

  it("accepts the tag list written with commas, spaces or hashes", () => {
    expect(parseTaskTags("#task, #project")).toEqual(["task", "project"]);
    expect(parseTaskTags("task project")).toEqual(["task", "project"]);
  });
});
