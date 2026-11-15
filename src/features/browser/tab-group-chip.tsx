import { useTranslation } from "react-i18next"

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from "@/components/ui/context-menu"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

import { type GroupColor, groupColors, type TabGroup } from "./tab-groups"

/** A group's colour: five hues of the theme's own that stay apart in both themes. */
const groupFill: Record<GroupColor, string> = {
  1: "bg-tab-group-1",
  2: "bg-tab-group-2",
  3: "bg-tab-group-3",
  4: "bg-tab-group-4",
  5: "bg-tab-group-5"
}
export const groupEdge: Record<GroupColor, string> = {
  1: "border-tab-group-1",
  2: "border-tab-group-2",
  3: "border-tab-group-3",
  4: "border-tab-group-4",
  5: "border-tab-group-5"
}

/** The name a group's tabs stand behind: pressed, it puts them away or brings them back. */
export function TabGroupChip({
  group,
  onChange,
  onToggle,
  onUngroup,
  onClose
}: {
  group: TabGroup
  onChange: (change: Partial<Pick<TabGroup, "title" | "color">>) => void
  onToggle: () => void
  onUngroup: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const name = group.title || t("browser.unnamedGroup")
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <button
            type="button"
            aria-label={t("browser.tabGroup", { title: name })}
            aria-expanded={!group.collapsed}
            className={cn(
              "mb-1.5 max-w-32 shrink-0 truncate rounded-md px-2 py-0.5 text-xs font-medium text-background",
              groupFill[group.color]
            )}
            onClick={onToggle}
          />
        }
      >
        {name}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <Input
          aria-label={t("browser.groupName")}
          placeholder={t("browser.groupName")}
          value={group.title}
          onChange={(event) => onChange({ title: event.target.value })}
          // Typing a name is not choosing from the menu.
          onKeyDown={(event) => event.stopPropagation()}
        />
        <div role="radiogroup" aria-label={t("browser.groupColor")} className="flex gap-2 px-2 py-2">
          {groupColors.map((color) => (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={group.color === color}
              aria-label={`${t("browser.groupColor")} ${color}`}
              className={cn(
                "size-5 rounded-full ring-offset-2 ring-offset-popover",
                groupFill[color],
                group.color === color && "ring-2 ring-ring"
              )}
              onClick={() => onChange({ color })}
            />
          ))}
        </div>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onUngroup}>{t("browser.ungroup")}</ContextMenuItem>
        <ContextMenuItem onClick={onClose}>{t("browser.closeGroup")}</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
