import React, { useEffect, useRef, useState } from "react";
import { AppContext } from "src/contexts/context";
import { ProjectPlannerSettings } from "src/types/settings";
import { EmbedSidebar } from "src/components/embed-sidebar";
import { GanttEmbedConfig } from "src/lib/gantt-embed";
import type ProjectPlannerPlugin from "../main";
import GanttView from "./GanttView";

interface GanttEmbedViewProps {
  plugin: ProjectPlannerPlugin;
  /** Dataview source the block names, already built from its spec */
  source: string;
  config: GanttEmbedConfig;
  /** What a tab opened from this block is called: the note holding it */
  title: string;
}

/**
 * A Gantt chart drawn inside a note, over only the tasks its block names.
 *
 * The chart is the same one the Gantt tab draws; the block only decides which
 * tasks it sees and how tall it is. A note has little room, so the chart can
 * be lifted out into a tab of its own that keeps the same tasks.
 */
export default function GanttEmbedView({
  plugin,
  source,
  config,
  title,
}: GanttEmbedViewProps) {
  const [settings, setSettings] = useState<ProjectPlannerSettings>({
    ...plugin.settings,
  });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.style.height = `${config.height}px`;
    }
  }, [config.height]);

  useEffect(() => {
    const handler = () => setSettings({ ...plugin.settings });
    window.addEventListener("project-planner:settings-changed", handler);
    return () =>
      window.removeEventListener("project-planner:settings-changed", handler);
  }, [plugin]);

  return (
    <AppContext.Provider value={plugin.app}>
      <div className="project-planner-embed-container" ref={containerRef}>
        <div className="project-planner-embed-inner">
          <GanttView settings={settings} plugin={plugin} source={source} />
        </div>
        <EmbedSidebar
          onOpenInTab={() => void plugin.openGanttForSource(source, title)}
        />
      </div>
    </AppContext.Provider>
  );
}
