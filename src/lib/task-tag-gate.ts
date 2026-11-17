import { RawTask } from "../types/task";
import { TAG_PATTERN } from "./task-regex";

/**
 * Which checkbox lines count as tasks.
 *
 * A Dataview `FROM` source narrows which *notes* are read, which is the right
 * tool for a project per folder. It cannot help a vault where real tasks and
 * stray `- [ ]` lines live in the same note — shopping lists, meeting notes,
 * a half-written checklist in a daily note. That is what this gate is for:
 * a line only counts if it carries one of the required tags.
 *
 * It runs on `RawTask` before `TaskFactory.parse()`, so excluded lines are
 * never parsed at all rather than parsed and then hidden. On a vault with
 * thousands of unrelated checkboxes that is the whole point of the request.
 */

/**
 * Splits what the user typed into tags. Accepts commas, whitespace or both,
 * with or without a leading `#`, so `#task, #project` and `task project` both
 * work and neither needs explaining.
 */
export function parseTaskTags(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(/[,\s]+/)
        .map((tag) => tag.trim().replace(/^#+/, ""))
        .filter((tag) => tag.length > 0)
    )
  );
}

/** The tags on one task line, without their `#`, lowercased for comparison. */
function tagsOnLine(text: string): string[] {
  // TAG_PATTERN carries the `g` flag and is shared, so matchAll (which does
  // not mutate lastIndex) is the safe way to scan with it.
  return Array.from(text.matchAll(TAG_PATTERN)).map((match) =>
    match[1].toLowerCase()
  );
}

/**
 * Whether `tag` satisfies `required`, treating a nested tag as belonging to its
 * parent: requiring `project` is met by `#project/alpha`, because Obsidian
 * presents those as one hierarchy and asking people to list every child would
 * make the setting useless on a real vault.
 */
function satisfies(tag: string, required: string): boolean {
  return tag === required || tag.startsWith(`${required}/`);
}

/**
 * Keeps only the lines carrying at least one required tag.
 *
 * An empty `required` means the gate is off and every line is returned
 * untouched, which is the default and the behaviour every existing vault
 * already has.
 */
export function gateTasksByTag(
  tasks: RawTask[],
  required: string[]
): RawTask[] {
  const wanted = required
    .map((tag) => tag.trim().replace(/^#+/, "").toLowerCase())
    .filter((tag) => tag.length > 0);

  if (wanted.length === 0) return tasks;

  return tasks.filter((task) => {
    const tags = tagsOnLine(task.text ?? "");
    return tags.some((tag) => wanted.some((want) => satisfies(tag, want)));
  });
}
