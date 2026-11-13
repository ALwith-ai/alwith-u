import type { SkillMetadata } from "@alwith/module-chat/client"
import { CheckIcon, XIcon } from "lucide-react"
import { useDeferredValue, useState } from "react"
import { useTranslation } from "react-i18next"
import { useStore } from "zustand"

import { Pane } from "@/components/alwith-ui/pane"
import {
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  PanelItem,
  PanelItemTitle,
  PanelList
} from "@/components/alwith-ui/panel-item"
import { toolboxContentClassName, toolboxDialogClassName } from "@/components/alwith-ui/toolbox-layout"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import { CatalogSkeleton } from "./catalog-skeleton"
import { pluginsStore } from "./instance"
import { SkillDocument } from "./skill-document"
import { SkillIcon } from "./skill-icon"

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

export function SkillsTab({ query, ready }: { query: string; ready: boolean }) {
  const { t } = useTranslation()
  const allSkills = useStore(pluginsStore, (state) => state.skills)
  const skills = allSkills.filter((skill) => skill.pluginId === null)
  const errors = useStore(pluginsStore, (state) => state.skillErrors)
  const loading = useStore(pluginsStore, (state) => state.skillsLoading && state.skills.length === 0) || !ready
  const loadProject = useStore(pluginsStore, (state) => state.loadSkillProject)
  const projectLoading = useStore(pluginsStore, (state) => state.skillProjectLoading)
  const projectErrors = useStore(pluginsStore, (state) => state.skillProjectErrors)
  const projects = useStore(pluginsStore, (state) => state.skillProjects)
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const q = useDeferredValue(query.trim().toLowerCase())
  const selected = skills.find((skill) => skill.path === selectedPath)
  const filtered = skills.filter((skill) =>
    [
      skill.name,
      skill.interface?.displayName,
      skill.description,
      skill.shortDescription,
      skill.interface?.shortDescription
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
  const currentLoading = currentGroup?.path ? projectLoading[currentGroup.path] : false
  const currentError = currentGroup?.path ? projectErrors[currentGroup.path] : undefined
  const groupSkills = currentGroup ? sorted.filter((skill) => currentGroup.paths.has(skill.path)) : []
  const groupExpanded = currentGroup ? expandedGroups[currentGroup.id] : false
  const groupSummary = groupExpanded || q ? groupSkills : groupSkills.slice(0, 6)
  const summary = expanded || q ? sorted : sorted.slice(0, 6)
  const renderSkills = (entries: SkillMetadata[]) => (
    <PanelList className="grid grid-cols-1 gap-x-8 gap-y-2 px-0 @min-[700px]:grid-cols-2">
      {entries.map((skill) => (
        <PanelItem
          key={skill.path}
          className="toolbox-row relative [contain-intrinsic-size:auto_80px] [content-visibility:auto]"
        >
          <Button
            variant="ghost"
            className="absolute inset-0 z-0 size-full"
            data-hover-background="none"
            aria-label={skill.interface?.displayName ?? skill.name}
            onClick={() => setSelectedPath(skill.path)}
          />
          <ItemMedia className="pointer-events-none relative translate-none! self-center!">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
              <SkillIcon name={skill.name} info={skill.interface} />
            </div>
          </ItemMedia>
          <ItemContent className="pointer-events-none relative min-w-0">
            <PanelItemTitle className="mb-0.5">{skill.interface?.displayName ?? skill.name}</PanelItemTitle>
            <ItemDescription
              className="line-clamp-1"
              title={skill.interface?.shortDescription ?? skill.shortDescription ?? skill.description}
            >
              {skill.interface?.shortDescription ?? skill.shortDescription ?? skill.description}
            </ItemDescription>
          </ItemContent>
          <ItemActions className="pointer-events-none relative w-8 shrink-0 justify-center text-muted-foreground">
            {skill.enabled ? (
              <CheckIcon className="size-4" strokeWidth={2} aria-label={t("plugins.skills.enabledStatus")} />
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
      <Pane className="pe-0" viewportClassName="pe-0">
        <div className={`${toolboxContentClassName} space-y-8 pt-6`}>
          {errors.map((error) => (
            <p key={error.path} role="alert" className="text-xs break-words text-destructive">
              {error.path}: {error.message}
            </p>
          ))}
          {Object.entries(projectErrors)
            .filter(([, error]) => error)
            .map(([cwd, error]) => (
              <div key={cwd} role="alert" className="flex items-center justify-between gap-2 text-xs text-destructive">
                <span>
                  {cwd}: {error}
                </span>
                <Button variant="outline" size="sm" onClick={() => void loadProject(cwd)}>
                  {t("plugins.loadError.retry")}
                </Button>
              </div>
            ))}
          {loading ? (
            <CatalogSkeleton skills />
          ) : (
            <>
              <section aria-label={t("plugins.skills.installed")}>
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h2 className="text-base font-medium">{t("plugins.skills.installed")}</h2>
                  <div className="flex items-center gap-3">
                    <span role="status" className="text-xs text-muted-foreground">
                      {t("plugins.catalog.skillCount", { count: sorted.length })}
                    </span>
                  </div>
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
                        className="h-8 flex-none rounded-lg px-3 text-[13px] font-medium shadow-none! after:hidden data-active:bg-muted! dark:data-active:border-transparent"
                      >
                        {group.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  {groups.map((group) => (
                    <TabsContent key={group.id} value={group.id}>
                      {group.id === currentGroup.id &&
                        (currentLoading ? (
                          <Spinner aria-label={t("plugins.skills.loading")} />
                        ) : currentError ? (
                          <div role="alert" className="space-y-2 text-sm text-destructive">
                            {currentError}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                if (group.path) void loadProject(group.path)
                              }}
                            >
                              {t("plugins.loadError.retry")}
                            </Button>
                          </div>
                        ) : groupSkills.length ? (
                          <>
                            {renderSkills(groupSummary)}
                            {!q && groupSkills.length > 6 && (
                              <Button
                                variant="ghost"
                                className="mt-3 max-w-full justify-start text-muted-foreground"
                                aria-expanded={groupExpanded}
                                onClick={() =>
                                  setExpandedGroups((value) => ({ ...value, [group.id]: !value[group.id] }))
                                }
                              >
                                {groupExpanded
                                  ? t("plugins.sections.showLess")
                                  : t("plugins.catalog.showMore", { count: groupSkills.length - 6 })}
                              </Button>
                            )}
                          </>
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
        <DialogContent showCloseButton={false} className={toolboxDialogClassName}>
          {selected && (
            <SkillDocument
              key={selected.path}
              path={selected.path}
              renderHeader={(actions) => (
                <>
                  <div className="flex items-center justify-between gap-4">
                    <SkillIcon name={selected.name} info={selected.interface} className="size-9 shrink-0" />
                    <div className="flex shrink-0 items-center gap-2">
                      <SkillToggle skill={selected} />
                      {actions}
                      <DialogClose render={<Button variant="ghost" size="icon-sm" aria-label={t("actions.close")} />}>
                        <XIcon />
                      </DialogClose>
                    </div>
                  </div>
                  <DialogHeader className="gap-3">
                    <DialogTitle className="text-2xl leading-8 font-semibold break-words">
                      {selected.interface?.displayName ?? selected.name}
                    </DialogTitle>
                    <DialogDescription className="text-sm leading-6 break-words whitespace-pre-wrap">
                      {selected.description}
                    </DialogDescription>
                  </DialogHeader>
                </>
              )}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
