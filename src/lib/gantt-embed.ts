import {
  EMPTY_TASK_SOURCE,
  TaskSourceSpec,
  coerceTaskSource,
} from "./task-source";

/** The language tag of a fenced block that draws a Gantt chart in a note. */
export const GANTT_EMBED_CODE_BLOCK = "project-planner-gantt";

export interface GanttEmbedConfig {
  height: number;
}

export const DEFAULT_GANTT_EMBED_CONFIG: GanttEmbedConfig = {
  height: 500,
};

export type GanttEmbedParseResult =
  | { kind: "ok"; source: TaskSourceSpec; config: GanttEmbedConfig }
  | { kind: "invalid" };

/**
 * Reads the body of a `project-planner-gantt` block.
 *
 * The body is JSON with two optional keys, `source` (which tasks the chart is
 * about) and `config` (how it is drawn). An empty body is a chart of every
 * task, like the Gantt tab. Fields of the wrong type fall back to their
 * defaults rather than failing the block, since people write these by hand.
 */
export function parseGanttEmbed(body: string): GanttEmbedParseResult {
  if (!body.trim()) {
    return {
      kind: "ok",
      source: { ...EMPTY_TASK_SOURCE },
      config: { ...DEFAULT_GANTT_EMBED_CONFIG },
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { kind: "invalid" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { kind: "invalid" };
  }

  const obj = parsed as Record<string, unknown>;
  const rawConfig =
    typeof obj.config === "object" && obj.config !== null
      ? (obj.config as Record<string, unknown>)
      : {};
  const height = rawConfig.height;

  return {
    kind: "ok",
    source: coerceTaskSource(obj.source),
    config: {
      height:
        typeof height === "number" && isFinite(height) && height > 0
          ? height
          : DEFAULT_GANTT_EMBED_CONFIG.height,
    },
  };
}
