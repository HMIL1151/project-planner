import React from "react";
import { Menu } from "obsidian";
import { MoreVertical } from "lucide-react";

/** One entry in a row's action menu. */
export interface RowMenuItem {
  /** An Obsidian icon id, which is a Lucide name in kebab case. */
  icon: string;
  label: string;
  onSelect: () => void;
}

interface GanttRowMenuProps {
  items: RowMenuItem[];
  /** Names the button for a screen reader and for its tooltip. */
  label: string;
}

/**
 * Every action a Gantt row offers, behind one button at the end of the row.
 *
 * The row used to carry a strip of icon buttons that faded in on hover, drawn
 * over the right-hand end of the row because reserving space for them would
 * have narrowed every task name. That strip covered the open-note button it
 * floated over, which is the one most people were reaching for (#15). A menu
 * costs one extra click and takes the whole problem away: nothing is ever
 * drawn over anything else, and the row looks the same hovered or not.
 *
 * Obsidian's own `Menu` rather than a popover of our own, because the label
 * column scrolls: a menu rendered inside it would be clipped at the column's
 * edge. This one is appended to the document, and comes with the vault's
 * theme, keyboard navigation and dismiss-on-outside-click for free.
 */
export function GanttRowMenu({ items, label }: GanttRowMenuProps) {
  const openMenu = (event: React.MouseEvent) => {
    // The row itself selects the task on click, which is not what pressing
    // its menu button means
    event.preventDefault();
    event.stopPropagation();

    const menu = new Menu();
    for (const item of items) {
      menu.addItem((entry) =>
        entry.setTitle(item.label).setIcon(item.icon).onClick(item.onSelect)
      );
    }
    menu.showAtMouseEvent(event.nativeEvent);
  };

  return (
    <button
      className="project-planner-gantt__row-menu"
      onClick={openMenu}
      title={label}
      aria-label={label}
      aria-haspopup="menu"
    >
      <MoreVertical size={12} />
    </button>
  );
}
