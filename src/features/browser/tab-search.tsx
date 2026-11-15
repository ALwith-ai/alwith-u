import { ChevronDown } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

interface Page {
  title: string
  url?: string
}
export interface TabSearchProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tabs: (Page & { id: string })[]
  /** Recently closed tabs, the oldest first. */
  closed: Page[]
  onSelect: (id: string) => void
  onReopen: (index: number) => void
}

type Match = (Page & { id: string }) | (Page & { closed: number })

/** The open and recently closed tabs whose title or address holds every word typed. */
export function matchTabs(tabs: TabSearchProps["tabs"], closed: Page[], query: string): Match[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const holds = (page: Page) => words.every((word) => `${page.title} ${page.url ?? ""}`.toLowerCase().includes(word))
  return [
    ...tabs.filter(holds),
    // The tab closed last comes first, as reopening would bring it back.
    ...closed
      .map((page, index) => ({ ...page, closed: index }))
      .filter(holds)
      .toReversed()
  ]
}

/** Find a tab among the open and the recently closed ones by typing part of its title or address. */
export function TabSearch({ open, onOpenChange, tabs, closed, onSelect, onReopen }: TabSearchProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const matches = matchTabs(tabs, closed, query)
  const choose = (match: Match | undefined) => {
    if (!match) return
    if ("closed" in match) onReopen(match.closed)
    else onSelect(match.id)
    onOpenChange(false)
  }
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setQuery("")
          setActive(0)
        }
        onOpenChange(next)
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="mb-1 size-7 shrink-0 rounded-full"
            aria-label={t("browser.searchTabs")}
          />
        }
      >
        <ChevronDown />
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-96 flex-col gap-2">
        <Input
          autoFocus
          aria-label={t("browser.searchTabs")}
          placeholder={t("browser.searchTabs")}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault()
              const step = event.key === "ArrowDown" ? 1 : matches.length - 1
              if (matches.length) setActive((active + step) % matches.length)
            } else if (event.key === "Enter") {
              event.preventDefault()
              choose(matches[active])
            }
          }}
        />
        {matches.length === 0 ? (
          <p className="px-1 text-sm text-muted-foreground">{t("browser.noTabsFound")}</p>
        ) : (
          <ul role="listbox" aria-label={t("browser.tabs")} className="flex max-h-80 flex-col overflow-auto">
            {matches.map((match, index) => (
              <li
                key={"closed" in match ? `closed:${match.closed}` : match.id}
                role="option"
                aria-selected={index === active}
              >
                <button
                  type="button"
                  className={cn(
                    "flex w-full min-w-0 items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                    index === active ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                  )}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(match)}
                >
                  <span className="min-w-0 flex-1 truncate">{match.title || match.url || t("browser.newTab")}</span>
                  {"closed" in match && (
                    <span className="shrink-0 text-xs text-muted-foreground">{t("browser.recentlyClosed")}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}
