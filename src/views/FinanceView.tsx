import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Events, Notice } from "obsidian";
import { useApp } from "src/hooks/hooks";
import { AppWithPlugins } from "src/types/obsidian-internals";
import { BaseTask } from "src/types/base-task";
import { getAllTasks } from "src/lib/utils";
import { buildGanttRows } from "src/lib/gantt-rows";
import { EMPTY_RATE_BOOK, RateBook } from "src/lib/rate-book";
import { readRateBook } from "src/lib/rate-book-note";
import {
  CostDimension,
  ReportOptions,
  TimeBucket,
  buildCostReport,
  costOverTime,
  groupCosts,
  topCostDrivers,
} from "src/lib/finance-summary";
import { CostIssue } from "src/lib/task-cost";
import FinanceToolbar from "src/components/finance-toolbar";
import FinanceKpis, { Kpi } from "src/components/finance-kpis";
import FinanceBarList, { BarItem } from "src/components/finance-bar-list";
import FinanceTimeline from "src/components/finance-timeline";
import FinanceIssues, { IssueGroup } from "src/components/finance-issues";
import { ProjectPlannerSettings } from "src/types/settings";
import ProjectPlannerPlugin from "../main";
import { t } from "../i18n";

interface FinanceViewProps {
  settings: ProjectPlannerSettings;
  plugin: ProjectPlannerPlugin;
}

/** Shown before the list turns into an "everything else" row. */
const MAX_GROUPS = 12;
const MAX_DRIVERS = 10;

export default function FinanceView({ settings, plugin }: FinanceViewProps) {
  const app = useApp();

  const [tasks, setTasks] = useState<BaseTask[]>([]);
  const [book, setBook] = useState<RateBook>(EMPTY_RATE_BOOK);
  const [rateNoteFound, setRateNoteFound] = useState(true);
  const [isLoading, setIsLoading] = useState(true);

  const [searchQuery, setSearchQuery] = useState("");
  const [hideCompleted, setHideCompleted] = useState(false);
  const [dimension, setDimension] = useState<CostDimension>("person");
  const [bucket, setBucket] = useState<TimeBucket>("month");
  const [includeInferred, setIncludeInferred] = useState(
    settings.financeIncludeInferred
  );

  /* ---------------------------------------------------------------------- */

  const load = useCallback(
    async (options: { notify?: boolean } = {}) => {
      setIsLoading(true);
      const { book: loaded, found } = await readRateBook(
        app,
        settings.financeRateNotePath
      );
      setBook(loaded);
      setRateNoteFound(found);
      setTasks(getAllTasks(app, settings.taskSource));
      setIsLoading(false);
      if (options.notify) new Notice(t("finance.reloaded"));
    },
    [app, settings.financeRateNotePath, settings.taskSource]
  );

  useEffect(() => {
    const dataviewPlugin = (app as AppWithPlugins).plugins?.plugins?.[
      "dataview"
    ];

    if (dataviewPlugin?.index?.initialized) {
      void load();
      return;
    }

    const metadataCache: Events = app.metadataCache;
    const eventRef = metadataCache.on("dataview:index-ready", () => {
      void load();
    });

    return () => {
      metadataCache.offref(eventRef);
    };
  }, [app, load]);

  /* ---------------------------------------------------------------------- */

  const formatMoney = useCallback(
    (value: number) => {
      try {
        return new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: settings.financeCurrency,
          maximumFractionDigits: 0,
        }).format(value);
      } catch {
        return String(Math.round(value));
      }
    },
    [settings.financeCurrency]
  );

  const formatHours = useCallback(
    (value: number) => t("finance.hours", { hours: Math.round(value) }),
    []
  );

  const visibleTasks = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return tasks.filter((task) => {
      if (
        hideCompleted &&
        (task.status === "done" || task.status === "canceled")
      ) {
        return false;
      }
      if (!query) return true;
      return task.summary.toLowerCase().includes(query);
    });
  }, [tasks, searchQuery, hideCompleted]);

  const rows = useMemo(
    () =>
      buildGanttRows(visibleTasks, {
        skipWeekends: settings.ganttSkipWeekends,
      }),
    [visibleTasks, settings.ganttSkipWeekends]
  );

  const options = useMemo<ReportOptions>(
    () => ({
      defaultHoursPerDay: settings.financeDefaultHoursPerDay,
      skipWeekends: settings.ganttSkipWeekends,
      includeInferred,
    }),
    [
      settings.financeDefaultHoursPerDay,
      settings.ganttSkipWeekends,
      includeInferred,
    ]
  );

  const report = useMemo(
    () => buildCostReport(rows, book, options),
    [rows, book, options]
  );

  /* ---------------------------------------------------------------------- */

  const kpis = useMemo<Kpi[]>(() => {
    const inferredShare =
      includeInferred && report.inferredTaskCount > 0
        ? t("finance.kpi_total_caveat", {
            amount: formatMoney(report.inferredTotal),
            count: report.inferredTaskCount,
          })
        : report.inferredTaskCount > 0
          ? t("finance.kpi_total_excluded", {
              amount: formatMoney(report.inferredTotal),
              count: report.inferredTaskCount,
            })
          : undefined;

    return [
      {
        key: "total",
        label: t("finance.kpi_total"),
        value: formatMoney(report.total),
        caveat: inferredShare,
        warning: Boolean(inferredShare),
      },
      {
        key: "labour",
        label: t("finance.kpi_labour"),
        value: formatMoney(report.labour),
      },
      {
        key: "materials",
        label: t("finance.kpi_materials"),
        value: formatMoney(report.materials),
      },
      {
        key: "hours",
        label: t("finance.kpi_hours"),
        value: formatHours(report.hours),
        caveat:
          report.unpricedHours > 0
            ? t("finance.kpi_hours_unpriced", {
                hours: Math.round(report.unpricedHours),
              })
            : undefined,
        warning: report.unpricedHours > 0,
      },
      {
        key: "priced",
        label: t("finance.kpi_priced"),
        value: String(report.pricedTasks),
      },
      {
        key: "unset",
        label: t("finance.kpi_no_finance"),
        value: String(report.tasksWithoutFinance),
      },
    ];
  }, [report, includeInferred, formatMoney, formatHours]);

  /** Labour against materials, as one pair of bars. */
  const splitItems = useMemo<BarItem[]>(
    () => [
      {
        key: "labour",
        label: t("finance.kpi_labour"),
        value: report.labour,
        display: formatMoney(report.labour),
      },
      {
        key: "materials",
        label: t("finance.kpi_materials"),
        value: report.materials,
        display: formatMoney(report.materials),
      },
    ],
    [report.labour, report.materials, formatMoney]
  );

  const groupLabel = useCallback(
    (key: string) => {
      if (key) return dimension === "tag" ? `#${key}` : key;
      // An empty key means "belongs to nobody in this dimension", which reads
      // differently depending on what is being grouped
      if (dimension === "person" || dimension === "grade") {
        return t("finance.unattributed");
      }
      return t(`finance.no_${dimension}`);
    },
    [dimension]
  );

  const breakdown = useMemo<BarItem[]>(() => {
    const groups = groupCosts(report, rows, dimension, options);
    const shown = groups.slice(0, MAX_GROUPS);
    const rest = groups.slice(MAX_GROUPS);

    const items: BarItem[] = shown.map((group) => ({
      key: group.key || "__none__",
      label: groupLabel(group.key),
      value: group.total,
      display: formatMoney(group.total),
      detail:
        group.hours > 0
          ? t("finance.group_detail", {
              hours: Math.round(group.hours),
              tasks: group.taskCount,
            })
          : undefined,
    }));

    if (rest.length > 0) {
      const total = rest.reduce((sum, group) => sum + group.total, 0);
      items.push({
        key: "__other__",
        label: t("finance.other_groups", { count: rest.length }),
        value: total,
        display: formatMoney(total),
      });
    }

    return items;
  }, [report, rows, dimension, options, groupLabel, formatMoney]);

  const drivers = useMemo<BarItem[]>(
    () =>
      topCostDrivers(report, rows, MAX_DRIVERS, options).map(
        ({ row, cost }) => ({
          key: row.task.id,
          label: row.task.summary,
          value: cost.total,
          display: formatMoney(cost.total),
          detail: t("finance.driver_detail", {
            hours: Math.round(cost.hours),
            days: cost.days,
          }),
          onClick: () => plugin.focusTaskInGantt(row.task.id),
        })
      ),
    [report, rows, options, formatMoney, plugin]
  );

  const buckets = useMemo(
    () => costOverTime(report, rows, bucket, options),
    [report, rows, bucket, options]
  );

  const formatBucketLabel = useCallback(
    (start: string) => (bucket === "month" ? start.slice(0, 7) : start),
    [bucket]
  );

  /* ---------------------------------------------------------------------- */

  const issueGroups = useMemo<IssueGroup[]>(() => {
    const byKind = new Map<CostIssue["kind"], string[]>();

    for (const entry of report.issues) {
      const lines = byKind.get(entry.issue.kind) ?? [];
      const detail =
        entry.issue.kind === "unknown-person"
          ? `${entry.summary} — ${entry.issue.person}`
          : entry.issue.kind === "no-rate"
            ? `${entry.summary} — ${entry.issue.person} (${entry.issue.grade})`
            : entry.issue.kind === "allocations-off"
              ? `${entry.summary} — ${Math.round(entry.issue.total * 100)}%`
              : entry.summary;

      lines.push(detail);
      byKind.set(entry.issue.kind, lines);
    }

    const groups: IssueGroup[] = [];

    for (const [kind, details] of byKind) {
      // Every task without dates carries this one, which would drown the rest;
      // the total's caveat already reports it
      if (kind === "inferred-schedule") continue;

      groups.push({
        key: kind,
        label: t(`finance.issue_${kind}`, { count: details.length }),
        details,
      });
    }

    if (book.problems.length > 0) {
      groups.push({
        key: "rate-note",
        label: t("finance.issue_rate_note", { count: book.problems.length }),
        details: book.problems.map((problem) =>
          problem.line > 0
            ? `${t(`finance.rate_problem_${problem.reason}`)} — ${t("finance.at_line", { line: problem.line })}: ${problem.text}`
            : `${t(`finance.rate_problem_${problem.reason}`)}${problem.text ? ` — ${problem.text}` : ""}`
        ),
      });
    }

    return groups;
  }, [report.issues, book.problems]);

  /* ---------------------------------------------------------------------- */

  if (isLoading) {
    return (
      <div className="project-planner-finance">
        <p className="project-planner-finance__empty">{t("finance.loading")}</p>
      </div>
    );
  }

  return (
    <div className="project-planner-finance">
      <FinanceToolbar
        onReload={() => void load({ notify: true })}
        searchQuery={searchQuery}
        onSearch={setSearchQuery}
        hideCompleted={hideCompleted}
        onHideCompletedChange={setHideCompleted}
        includeInferred={includeInferred}
        onIncludeInferredChange={setIncludeInferred}
        dimension={dimension}
        onDimensionChange={setDimension}
        bucket={bucket}
        onBucketChange={setBucket}
        skipWeekends={settings.ganttSkipWeekends}
        total={formatMoney(report.total)}
      />

      <div className="project-planner-finance__body">
        {!rateNoteFound && (
          <div className="project-planner-finance__callout">
            <span>
              {t("finance.no_rate_note", {
                path: settings.financeRateNotePath,
              })}
            </span>
            <button onClick={() => void plugin.createRateNote()} type="button">
              {t("finance.create_rate_note")}
            </button>
          </div>
        )}

        <FinanceKpis kpis={kpis} />

        <section className="project-planner-finance__section">
          <h3>{t("finance.split_title")}</h3>
          <FinanceBarList items={splitItems} emptyLabel={t("finance.empty")} />
        </section>

        <section className="project-planner-finance__section">
          <h3>{t(`finance.breakdown_${dimension}`)}</h3>
          <FinanceBarList items={breakdown} emptyLabel={t("finance.empty")} />
        </section>

        <section className="project-planner-finance__section">
          <h3>{t("finance.over_time_title")}</h3>
          <p className="project-planner-finance__note">
            {t("finance.spread_note")}
          </p>
          <FinanceTimeline
            buckets={buckets}
            formatLabel={formatBucketLabel}
            formatMoney={formatMoney}
            labourLabel={t("finance.kpi_labour")}
            materialsLabel={t("finance.kpi_materials")}
            emptyLabel={t("finance.empty")}
          />
        </section>

        <section className="project-planner-finance__section">
          <h3>{t("finance.drivers_title")}</h3>
          <FinanceBarList items={drivers} emptyLabel={t("finance.empty")} />
        </section>

        <section className="project-planner-finance__section">
          <h3>{t("finance.problems_title")}</h3>
          <FinanceIssues
            groups={issueGroups}
            emptyLabel={t("finance.no_problems")}
          />
        </section>
      </div>
    </div>
  );
}
