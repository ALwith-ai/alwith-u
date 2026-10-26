import { convertFileSrc } from "@tauri-apps/api/core"
import { CheckIcon, SparklesIcon, XIcon } from "lucide-react"
import { useDeferredValue, useState } from "react"
import { useTranslation } from "react-i18next"
import { useStore } from "zustand"

import type { SkillMetadata } from "@/agent/codex-extensions"
import { Pane } from "@/components/alwith-ui/pane"
import {
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  PanelItem,
  PanelList
} from "@/components/alwith-ui/panel-item"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { ItemTitle } from "@/components/ui/item"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import { CatalogSkeleton } from "./catalog-skeleton"
import { pluginsStore } from "./instance"
import { SkillDocument } from "./skill-document"
import type { PluginEntry } from "./store"

function SkillIcon({ skill }: { skill: SkillMetadata }) {
  const [failed, setFailed] = useState(false)
  const local = skill.interface?.iconSmall
  const src = local ? convertFileSrc(local) : skill.interface?.iconSmallUrl
  return (
    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
      {src && !failed ? (
        <img src={src} alt="" onError={() => setFailed(true)} className="size-8 rounded object-contain" />
      ) : (
        <SparklesIcon className="size-5 text-muted-foreground" />
      )}
    </div>
  )
}

function SkillToggle({ skill }: { skill: SkillMetadata }) {
  const { t } = useTranslation()
  const toggle = useStore(pluginsStore, (state) => state.setSkillEnabled)
  const busy = useStore(pluginsStore, (state) => skill.path in state.busySkills)
  return (
    <div className="flex items-center gap-2">
      {busy && <Spinner className="size-3.5 text-muted-foreground" />}
      <Switch
        checked={skill.enabled}
        disabled={busy}
        aria-label={`${t(skill.enabled ? "plugins.skills.disable" : "plugins.skills.enable")}: ${skill.interface?.displayName ?? skill.name}`}
        onCheckedChange={(enabled) => void toggle(skill, enabled)}
      />
    </div>
  )
}

export function SkillsTab({
  query,
  ready,
  onOpenPlugin
}: {
  query: string
  ready: boolean
  onOpenPlugin: (entry: PluginEntry) => void
}) {
  const { t } = useTranslation()
  const skills = useStore(pluginsStore, (state) => state.skills)
  const errors = useStore(pluginsStore, (state) => state.skillErrors)
  const loading = useStore(pluginsStore, (state) => state.loading) || !ready
  const installed = useStore(pluginsStore, (state) => state.installed)
  const projects = useStore(pluginsStore, (state) => state.skillProjects)
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const q = useDeferredValue(query.trim().toLowerCase())
  const selected = skills.find((skill) => skill.path === selectedPath)
  const owner = installed.find(({ plugin }) => plugin.id === selected?.pluginId)
  const filtered = skills.filter((skill) =>
    [
      skill.name,
      skill.interface?.displayName,
      skill.description,
      skill.shortDescription,
      skill.interface?.shortDescription,
      skill.pluginId
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(q)
  )
  const sorted = filtered.toSorted((a, b) =>
    (a.interface?.displayName ?? a.name).localeCompare(b.interface?.displayName ?? b.name)
  )
  const groups = [
    ...(["user", "system", "admin"] as const).flatMap((scope) => {
      const entries = skills.filter((skill) => skill.scope === scope)
      return entries.length
        ? [
            {
              id: scope,
              label: t(scope === "user" ? "plugins.catalog.personal" : `plugins.skills.scope.${scope}`),
              paths: new Set(entries.map((skill) => skill.path)),
              path: null
            }
          ]
        : []
    }),
    ...Object.entries(projects).flatMap(([cwd, paths]) => {
      if (!skills.some((skill) => skill.scope === "repo" && paths.includes(skill.path))) return []
      const name =
        cwd
          .replace(/[\\/]+$/, "")
          .split(/[\\/]/)
          .at(-1) || cwd
      return [{ id: `project:${cwd}`, label: name, paths: new Set(paths), path: cwd }]
    })
  ]
  const groupLabels = groups.map((group) => group.label)
  for (const group of groups) {
    if (group.path && groupLabels.filter((label) => label === group.label).length > 1) {
      group.label = group.path
    }
  }
  const currentGroup = groups.find((group) => group.id === selectedGroup) ?? groups[0]
  const groupSkills = currentGroup ? sorted.filter((skill) => currentGroup.paths.has(skill.path)) : []
  const summary = expanded || q ? sorted : sorted.slice(0, 6)
  const renderSkills = (entries: SkillMetadata[]) => (
    <PanelList className="grid grid-cols-1 gap-x-6 gap-y-3 @min-[700px]:grid-cols-2">
      {entries.map((skill) => (
        <PanelItem
          key={skill.path}
          className="relative rounded-lg py-4 [contain-intrinsic-size:auto_80px] [content-visibility:auto]"
        >
          <Button
            variant="ghost"
            className="absolute inset-0 z-0 size-full"
            aria-label={skill.interface?.displayName ?? skill.name}
            onClick={() => setSelectedPath(skill.path)}
          />
          <ItemMedia className="pointer-events-none relative">
            <SkillIcon skill={skill} />
          </ItemMedia>
          <ItemContent className="pointer-events-none relative min-w-0">
            <ItemTitle className="block truncate">{skill.interface?.displayName ?? skill.name}</ItemTitle>
            <ItemDescription
              className="line-clamp-1"
              title={skill.interface?.shortDescription ?? skill.shortDescription ?? skill.description}
            >
              {skill.interface?.shortDescription ?? skill.shortDescription ?? skill.description}
            </ItemDescription>
          </ItemContent>
          <ItemActions className="pointer-events-none relative text-muted-foreground">
            {skill.enabled ? (
              <CheckIcon className="size-4" aria-label={t("plugins.skills.enabledStatus")} />
            ) : (
              <span className="text-xs">{t("plugins.skills.disabledBadge")}</span>
            )}
          </ItemActions>
        </PanelItem>
      ))}
    </PanelList>
  )
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <Pane nativeScroll viewportClassName="pe-2">
        <div className="space-y-6">
          {errors.map((error) => (
            <p key={error.path} role="alert" className="text-xs break-words text-destructive">
              {error.path}: {error.message}
            </p>
          ))}
          {loading ? (
            <CatalogSkeleton skills />
          ) : (
            <>
              <section aria-label={t("plugins.skills.installed")}>
                <div className="mb-4 flex items-center justify-between border-b px-2 pb-4">
                  <h2 className="text-base font-semibold">{t("plugins.skills.installed")}</h2>
                  <span role="status" className="text-xs text-muted-foreground">
                    {t("plugins.catalog.skillCount", { count: sorted.length })}
                  </span>
                </div>
                {sorted.length ? (
                  renderSkills(summary)
                ) : (
                  <p className="px-2 py-8 text-sm text-muted-foreground">
                    {t(q ? "plugins.skills.filteredEmpty" : "plugins.skills.empty")}
                  </p>
                )}
                {!q && sorted.length > 6 && (
                  <Button
                    variant="ghost"
                    className="mt-3 max-w-full justify-start text-muted-foreground"
                    aria-expanded={expanded}
                    onClick={() => setExpanded((value) => !value)}
                  >
                    {expanded
                      ? t("plugins.sections.showLess")
                      : t("plugins.catalog.showMore", { count: sorted.length - 6 })}
                  </Button>
                )}
              </section>
              {currentGroup && (
                <Tabs
                  value={currentGroup.id}
                  onValueChange={(value) => {
                    if (typeof value === "string") setSelectedGroup(value)
                  }}
                  className="gap-6"
                >
                  <TabsList
                    aria-label={t("plugins.catalog.scope")}
                    className="h-auto max-w-full flex-wrap justify-start gap-2 bg-transparent"
                  >
                    {groups.map((group) => (
                      <TabsTrigger
                        key={group.id}
                        value={group.id}
                        title={group.path ?? group.label}
                        className="flex-none rounded-full px-4 py-2 shadow-none! after:hidden data-active:bg-muted! dark:data-active:border-transparent"
                      >
                        {group.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  {groups.map((group) => (
                    <TabsContent key={group.id} value={group.id}>
                      {group.id === currentGroup.id &&
                        (groupSkills.length ? (
                          renderSkills(groupSkills)
                        ) : (
                          <p className="px-2 py-8 text-sm text-muted-foreground">{t("plugins.skills.filteredEmpty")}</p>
                        ))}
                    </TabsContent>
                  ))}
                </Tabs>
              )}
            </>
          )}
        </div>
      </Pane>
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelectedPath(null)
        }}
      >
        <DialogContent showCloseButton={false} className="max-h-[85dvh] overflow-y-auto rounded-3xl sm:max-w-3xl">
          {selected && (
            <>
              <SkillDocument
                key={selected.path}
                path={selected.path}
                renderHeader={(actions) => (
                  <>
                    <div className="flex items-center justify-between gap-4">
                      <SkillIcon skill={selected} />
                      <div className="flex shrink-0 items-center gap-2">
                        <SkillToggle skill={selected} />
                        {actions}
                        <DialogClose render={<Button variant="ghost" size="icon-sm" aria-label={t("actions.close")} />}>
                          <XIcon />
                        </DialogClose>
                      </div>
                    </div>
                    <DialogHeader className="gap-3">
                      <DialogTitle className="text-xl leading-tight break-words">
                        {selected.interface?.displayName ?? selected.name}
                      </DialogTitle>
                      <DialogDescription className="text-sm leading-6 break-words whitespace-pre-wrap">
                        {selected.description}
                      </DialogDescription>
                    </DialogHeader>
                  </>
                )}
              />
              {selected.pluginId && (
                <div className="text-sm">
                  <span className="text-muted-foreground">{t("plugins.catalog.fromPlugin")} </span>
                  {owner ? (
                    <Button
                      variant="link"
                      className="h-auto p-0"
                      onClick={() => {
                        setSelectedPath(null)
                        onOpenPlugin(owner)
                      }}
                    >
                      {owner.plugin.interface?.displayName ?? owner.plugin.name}
                    </Button>
                  ) : (
                    selected.pluginId
                  )}
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
