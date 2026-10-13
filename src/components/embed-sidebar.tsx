import React from "react";
import { Maximize2, RefreshCw } from "lucide-react";
import { t } from "../i18n";

interface EmbedSidebarProps {
  onReload?: () => void;
  onOpenInTab?: () => void;
}

export function EmbedSidebar({ onReload, onOpenInTab }: EmbedSidebarProps) {
  return (
    <div className="project-planner-embed-sidebar">
      {onReload && (
        <button
          className="project-planner-embed-sidebar__button"
          onClick={onReload}
          aria-label={t("filters.reload_tasks")}
          title={t("filters.reload_tasks")}
        >
          <RefreshCw size={14} />
        </button>
      )}
      {onOpenInTab && (
        <button
          className="project-planner-embed-sidebar__button"
          onClick={onOpenInTab}
          aria-label={t("embed.open_in_tab")}
          title={t("embed.open_in_tab")}
        >
          <Maximize2 size={14} />
        </button>
      )}
    </div>
  );
}
