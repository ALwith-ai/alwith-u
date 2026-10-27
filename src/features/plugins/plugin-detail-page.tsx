import { convertFileSrc } from "@tauri-apps/api/core"
import { ChevronRightIcon, ExternalLinkIcon } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { useStore } from "zustand"

import type { PluginDetail } from "@nyssance/codex-acp-v2/client"
import { Pane } from "@/components/alwith-ui/pane"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { openExternal } from "@/lib/open"

import { pluginsStore } from "./instance"
import { PluginIcon } from "./plugin-icon"
import { SkillDocument } from "./skill-document"
import type { PluginEntry } from "./store"

/** Desktop's breadcrumb, hero, information strip and capability lists, fed by Codex's source catalog. */
export function PluginDetailPage({ entry, onBack }: { entry: PluginEntry; onBack: () => void }) {
  const { t } = useTranslation()
  const read = useStore(pluginsStore, (state) => state.readPlugin)
  const installed = useStore(pluginsStore, (state) =>
    state.installed.find(({ plugin }) => plugin.id === entry.plugin.id)
  )
  const busy = useStore(pluginsStore, (state) => state.busyIds[entry.plugin.id])
  const install = useStore(pluginsStore, (state) => state.install)
  const uninstall = useStore(pluginsStore, (state) => state.uninstall)
  const toggle = useStore(pluginsStore, (state) => state.setPluginEnabled)
  const [detail, setDetail] = useState<PluginDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [skill, setSkill] = useState<PluginDetail["skills"][number] | null>(null)
  useEffect(() => {
    let alive = true
    setError(null)
    setDetail(null)
    void read(entry).then(
      (result) => {
        if (alive) setDetail(result)
      },
      (failure: unknown) => {
        if (alive) setError(failure instanceof Error ? failure.message : String(failure))
      }
    )
    return () => {
      alive = false
    }
  }, [entry, read, attempt])
  const summary = detail?.summary ?? entry.plugin
  const current = installed?.plugin ?? summary
  const info = summary.interface
  const title = info?.displayName ?? summary.name
  const unavailable = current.availability !== "AVAILABLE" || current.installPolicy === "NOT_AVAILABLE"
  const description = info?.longDescription ?? detail?.description ?? info?.shortDescription
  const screenshots = [
    ...(info?.screenshots.map((path) => convertFileSrc(path)) ?? []),
    ...(info?.screenshotUrls ?? [])
  ]
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <nav
        aria-label={t("plugins.detail.root")}
        className="mx-auto flex w-full max-w-3xl shrink-0 items-center gap-1 px-6 pt-4 text-sm"
      >
        <Button variant="link" className="h-auto p-0 text-muted-foreground" onClick={onBack}>
          {t("plugins.detail.root")}
        </Button>
        <ChevronRightIcon className="size-3.5 text-muted-foreground rtl:-scale-x-100" />
        <span aria-current="page" className="truncate">
          {title}
        </span>
      </nav>
      <Pane>
        <div className="mx-auto w-full max-w-3xl px-6 py-8">
          <PluginIcon name={summary.name} className="size-16 rounded-lg" />
          <div className="mt-4 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-3xl font-semibold">{title}</h1>
              {info?.shortDescription && <p className="mt-1 text-sm text-muted-foreground">{info.shortDescription}</p>}
              {summary.keywords.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {[...new Set(summary.keywords)].map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-[10px] font-normal">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            {installed ? (
              <div className="flex shrink-0 items-center gap-3">
                <Switch
                  checked={current.enabled}
                  disabled={!!busy || unavailable}
                  aria-label={t(current.enabled ? "plugins.card.disable" : "plugins.card.enable", {
                    pluginName: title
                  })}
                  onCheckedChange={(enabled) => void toggle(current, enabled)}
                />
                <Button variant="destructive" disabled={!!busy} onClick={() => void uninstall(current)}>
                  {busy ? <Spinner /> : t("plugins.detail.uninstall")}
                </Button>
              </div>
            ) : (
              <Button
                className="shrink-0 rounded-md"
                disabled={!!busy || unavailable}
                onClick={() => void install({ ...entry, plugin: summary }).catch(() => {})}
              >
                {busy ? <Spinner /> : t(unavailable ? "plugins.detail.unavailable" : "plugins.detail.install")}
              </Button>
            )}
          </div>
          <div className="mt-6 flex items-stretch overflow-x-auto border-y py-4">
            {info?.developerName && <InfoCell label={t("plugins.detail.developer")}>{info.developerName}</InfoCell>}
            {info?.category && <InfoCell label={t("plugins.detail.category")}>{info.category}</InfoCell>}
            {(current.localVersion ?? current.version) && (
              <InfoCell label={t("plugins.detail.version")}>{current.localVersion ?? current.version}</InfoCell>
            )}
            <InfoCell label={t("plugins.headings.marketplace")}>
              {entry.marketplace.interface?.displayName ?? entry.marketplace.name}
            </InfoCell>
            {info?.websiteUrl && (
              <InfoCell label={t("plugins.detail.website")}>
                <SourceLink url={info.websiteUrl} label={t("plugins.detail.website")} />
              </InfoCell>
            )}
          </div>
          {!detail && !error && (
            <div role="status" className="mt-8 flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner />
              {t("plugins.detail.loading")}
            </div>
          )}
          {error && (
            <div role="alert" className="mt-8 space-y-2">
              <p className="text-sm text-destructive">
                {t("plugins.detail.errorTitle")}: {error}
              </p>
              <Button variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>
                {t("plugins.loadError.retry")}
              </Button>
            </div>
          )}
          {description && <p className="mt-8 text-sm leading-6 whitespace-pre-wrap">{description}</p>}
          {screenshots.length > 0 && (
            <div className="mt-6 flex gap-3 overflow-x-auto">
              {[...new Set(screenshots)].map((src) => (
                <img
                  key={src}
                  src={src}
                  alt={title}
                  loading="lazy"
                  className="max-h-72 max-w-full rounded-xl border object-contain"
                />
              ))}
            </div>
          )}
          {info && info.capabilities.length > 0 && (
            <DetailSection label={t("plugins.detail.capabilities")} count={info.capabilities.length}>
              {info.capabilities.map((value) => (
                <Badge key={value} variant="secondary" className="me-2">
                  {value}
                </Badge>
              ))}
            </DetailSection>
          )}
          {detail && detail.mcpServers.length > 0 && (
            <DetailSection label={t("plugins.detail.mcpServers")} count={detail.mcpServers.length}>
              {detail.mcpServers.map((name) => (
                <div key={name} className="flex items-center gap-3 py-1">
                  <PluginIcon name={summary.name} className="size-6 rounded-md" />
                  <span className="text-sm font-medium">{name}</span>
                </div>
              ))}
            </DetailSection>
          )}
          {detail && detail.skills.length > 0 && (
            <DetailSection label={t("plugins.detail.skills")} count={detail.skills.length}>
              {detail.skills.map((item) => (
                <Button
                  key={item.path ?? item.name}
                  variant="ghost"
                  className="h-auto w-full justify-start gap-3 rounded-xl bg-muted/50 px-4 py-3 text-start whitespace-normal hover:bg-muted"
                  onClick={() => setSkill(item)}
                >
                  <PluginIcon name={item.name} className="size-8" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{item.interface?.displayName ?? item.name}</span>
                    <span className="mt-1 block truncate text-xs font-normal text-muted-foreground">
                      {item.interface?.shortDescription ?? item.shortDescription ?? item.description}
                    </span>
                  </span>
                </Button>
              ))}
            </DetailSection>
          )}
          {detail && detail.apps.length > 0 && (
            <DetailSection label={t("plugins.detail.apps")} count={detail.apps.length}>
              {detail.apps.map((app) => (
                <div key={app.id} className="rounded-xl bg-muted/50 px-4 py-3">
                  <div className="text-sm font-medium">{app.name}</div>
                  {app.description && <p className="mt-1 text-xs text-muted-foreground">{app.description}</p>}
                  {app.installUrl && <SourceLink url={app.installUrl} label={t("plugins.installModal.connect")} />}
                </div>
              ))}
            </DetailSection>
          )}
          {detail && detail.hooks.length > 0 && (
            <DetailSection label={t("plugins.detail.hooks")} count={detail.hooks.length}>
              {detail.hooks.map((hook) => (
                <p key={hook.key} className="text-sm">
                  {hook.eventName}
                </p>
              ))}
            </DetailSection>
          )}
          {(info?.privacyPolicyUrl || info?.termsOfServiceUrl) && (
            <div className="mt-10 flex flex-wrap gap-4 border-t pt-4">
              {info.privacyPolicyUrl && (
                <SourceLink url={info.privacyPolicyUrl} label={t("plugins.detail.privacyPolicy")} />
              )}
              {info.termsOfServiceUrl && (
                <SourceLink url={info.termsOfServiceUrl} label={t("plugins.detail.termsOfService")} />
              )}
            </div>
          )}
        </div>
      </Pane>
      <Dialog
        open={skill !== null}
        onOpenChange={(open) => {
          if (!open) setSkill(null)
        }}
      >
        <DialogContent className="flex max-h-[85dvh] flex-col gap-4 overflow-hidden rounded-xl sm:max-w-3xl">
          {skill && (
            <>
              <div className="shrink-0 pr-8">
                <PluginIcon name={skill.name} className="size-12" />
              </div>
              <div className="min-h-0 overflow-y-auto overscroll-contain">
                <DialogHeader className="gap-3">
                  <DialogTitle className="text-xl leading-tight break-words">
                    {skill.interface?.displayName ?? skill.name}
                  </DialogTitle>
                  <DialogDescription className="text-sm leading-6 break-words whitespace-pre-wrap">
                    {skill.description}
                  </DialogDescription>
                </DialogHeader>
                <SkillDocument key={skill.path ?? skill.name} path={skill.path} description={skill.description} />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function InfoCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-28 shrink-0 flex-col items-center justify-between gap-1.5 border-e px-6 first:ps-2 last:border-e-0">
      <span className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</span>
      <span className="flex items-center text-sm font-medium">{children}</span>
    </div>
  )
}
function DetailSection({ label, count, children }: { label: string; count: number; children: ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-sm font-semibold">
        {label} <span className="font-normal text-muted-foreground">{count}</span>
      </h2>
      <div className="mt-3 flex flex-col gap-2">{children}</div>
    </section>
  )
}
function SourceLink({ url, label }: { url: string; label: string }) {
  if (!/^https?:\/\//i.test(url)) return null
  return (
    <Button
      variant="link"
      className="h-auto p-0 text-xs text-muted-foreground"
      title={url}
      onClick={() => void openExternal(url).catch((error: unknown) => toast.error(String(error)))}
    >
      {label}
      <ExternalLinkIcon className="size-3.5" />
    </Button>
  )
}
