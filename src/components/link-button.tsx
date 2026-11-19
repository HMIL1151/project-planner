import React from "react";
import { App } from "obsidian";
import { ArrowUpRight } from "lucide-react";
import { openTaskLink } from "src/lib/open-task-link";

interface LinkButtonProps {
  taskStatus?: "todo" | "done" | "canceled" | "in_progress";
  link: string;
  app: App;
}

export const LinkButton = ({
  link,
  app,
  taskStatus = "todo",
}: LinkButtonProps) => {
  const status =
    taskStatus === "done"
      ? "success"
      : taskStatus === "canceled"
        ? "error"
        : "normal";
  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await openTaskLink(app, link);
  };

  return (
    <button
      className={`project-planner-link-button project-planner-link-button--${status}`}
      onClick={(e) => void handleClick(e)}
    >
      <ArrowUpRight size={16} />
    </button>
  );
};
