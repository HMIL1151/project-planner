/**
 * Which part of the vault a view reads its tasks from.
 *
 * The answer is handed to Dataview as a source — the part of a query that
 * follows `FROM` — so a vault with thousands of tasks can give one project its
 * own chart without the rest ever being parsed. Folders, files and tags are
 * the common cases and are spelled out as lists; `query` takes any other
 * Dataview source for the cases they cannot say, such as an exclusion.
 */
export interface TaskSourceSpec {
  folders: string[];
  files: string[];
  tags: string[];
  query: string;
}

export const EMPTY_TASK_SOURCE: TaskSourceSpec = {
  folders: [],
  files: [],
  tags: [],
  query: "",
};

/** Quotes a path for a Dataview source, where a bare path would not parse. */
function quotePath(path: string): string {
  return `"${path.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * The Dataview source a spec stands for, or `""` when it names nothing and
 * the whole vault is meant.
 *
 * Every part widens the set — a task in any of the folders, any of the files,
 * or carrying any of the tags is in — so the parts are joined with `or`.
 */
export function buildDataviewSource(spec: TaskSourceSpec): string {
  const parts = [
    ...spec.folders
      .map((folder) => folder.trim().replace(/\/+$/, ""))
      .filter(Boolean)
      .map(quotePath),
    ...spec.files
      .map((file) => file.trim())
      .filter(Boolean)
      .map(quotePath),
    ...spec.tags
      .map((tag) => tag.trim().replace(/^#/, ""))
      .filter(Boolean)
      .map((tag) => `#${tag}`),
  ];
  const query = spec.query.trim();
  if (query) parts.push(parts.length > 0 ? `(${query})` : query);
  return parts.join(" or ");
}

/**
 * Narrows the vault-wide source from the settings by a view's own.
 *
 * Both have to hold: the settings say what the plugin may read at all (say,
 * everything but the archive), the view says which project it is about.
 */
export function combineSources(vaultSource: string, viewSource: string) {
  const vault = vaultSource.trim();
  const view = viewSource.trim();
  if (!vault) return view;
  if (!view) return vault;
  return `(${vault}) and (${view})`;
}

function coerceStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return [];
}

/**
 * Reads a `source` object out of an embed block, forgiving the shapes people
 * write by hand: a single string where a list was meant, or a bare string for
 * the whole thing, taken as a raw Dataview source.
 */
export function coerceTaskSource(raw: unknown): TaskSourceSpec {
  if (typeof raw === "string") return { ...EMPTY_TASK_SOURCE, query: raw };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ...EMPTY_TASK_SOURCE };
  }
  const obj = raw as Record<string, unknown>;
  return {
    folders: coerceStrings(obj.folders),
    files: coerceStrings(obj.files),
    tags: coerceStrings(obj.tags),
    query: typeof obj.query === "string" ? obj.query : "",
  };
}
