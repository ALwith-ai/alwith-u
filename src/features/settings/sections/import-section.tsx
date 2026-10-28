import { ArrowDownToLineIcon, CheckIcon, ChevronRightIcon, RefreshCwIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { type ImportAction, requestImportAction, useImportState } from "@/lib/imports-bridge"

import { SettingGroup, SettingRow } from "./shared"

const SOURCES = [
  { id: "claude-code", label: "Claude Code" },
  { id: "cursor", label: "Cursor" }
] as const

export function ImportSection() {
  const { t } = useTranslation()
  const state = useImportState()
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<number[]>([])
  const selecting = state?.phase === "selecting"
  useEffect(() => {
    setSelected([])
  }, [state?.source, selecting])
  const busy = state?.phase === "detecting" || state?.phase === "importing"
  const send = (action: ImportAction) => {
    void requestImportAction(action).catch((error: unknown) => toast.error(String(error)))
  }
  const source = SOURCES.find((entry) => entry.id === state?.source)?.label
  const failures = state?.results.flatMap((result) => result.failures) ?? []
  const successes = state?.results.flatMap((result) => result.successes) ?? []
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">{t("imports.title")}</h2>
        <Button variant="ghost" size="sm" disabled={busy || state === null} onClick={() => send({ action: "refresh" })}>
          <RefreshCwIcon data-icon="inline-start" />
          {t("imports.refresh")}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{t("imports.description")}</p>
      {state?.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <SettingGroup>
        {SOURCES.map((entry) => (
          <SettingRow key={entry.id} title={entry.label}>
            <Button
              variant="outline"
              size="sm"
              disabled={state === null || busy}
              onClick={() => {
                setOpen(true)
                send({ action: "detect", source: entry.id })
              }}
            >
              {t("imports.import")}
              <ChevronRightIcon data-icon="inline-end" />
            </Button>
          </SettingRow>
        ))}
      </SettingGroup>
      {busy && (
        <div role="status" className="flex items-center gap-3">
          <Spinner />
          <span>{t(state.phase === "detecting" ? "imports.detecting" : "imports.importing")}</span>
          <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
            {t("imports.details")}
          </Button>
        </div>
      )}
      <section className="flex flex-col gap-3" aria-label={t("imports.history")}>
        <h3 className="text-sm font-medium">{t("imports.history")}</h3>
        {state === null ? (
          <Spinner />
        ) : state.history.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("imports.noHistory")}</p>
        ) : (
          state.history.map((entry) => (
            <div key={entry.importId} className="flex flex-col gap-1 border-b py-3 last:border-0">
              <div className="flex items-center justify-between gap-3">
                <span>
                  {SOURCES.find((item) => item.id === entry.providerId)?.label ??
                    entry.providerId ??
                    t("imports.import")}
                </span>
                <time className="text-xs text-muted-foreground">
                  {new Date(Number(entry.completedAtMs)).toLocaleString()}
                </time>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("imports.summary", { success: entry.successes.length, failed: entry.failures.length })}
              </p>
              {entry.failures.map((failure, index) => (
                <p key={index} className="text-xs text-destructive">
                  {failure.source}: {failure.message}
                </p>
              ))}
            </div>
          ))
        )}
      </section>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("imports.from", { source: source ?? "" })}</DialogTitle>
            <DialogDescription>{t("imports.chooseDescription")}</DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
            {state?.phase === "detecting" && (
              <div role="status" className="flex items-center gap-2 py-6">
                <Spinner />
                {t("imports.detecting")}
              </div>
            )}
            {state?.phase === "selecting" &&
              (state.items.length === 0 ? (
                <p className="py-6 text-muted-foreground">{t("imports.empty")}</p>
              ) : (
                ["setup", "projects", "chats"].map((group) => {
                  const entries = state.items
                    .map((item, index) => ({ item, index }))
                    .filter(
                      ({ item }) => (item.itemType === "SESSIONS" ? "chats" : item.cwd ? "projects" : "setup") === group
                    )
                  if (!entries.length) return null
                  return (
                    <section key={group} className="flex flex-col gap-2">
                      <h3 className="text-sm font-medium">
                        {t(`imports.${group}`)} ({entries.length})
                      </h3>
                      {entries.map(({ item, index }) => (
                        <Field key={index} orientation="horizontal" className="items-start py-2">
                          <Checkbox
                            id={`import-${index}`}
                            checked={selected.includes(index)}
                            onCheckedChange={(checked) =>
                              setSelected((current) =>
                                checked === true ? [...current, index] : current.filter((value) => value !== index)
                              )
                            }
                          />
                          <FieldLabel htmlFor={`import-${index}`} className="min-w-0 flex-1 flex-col items-start gap-1">
                            <span>{t(`imports.types.${item.itemType}`)}</span>
                            <span className="text-xs font-normal break-all text-muted-foreground">
                              {item.description}
                            </span>
                          </FieldLabel>
                        </Field>
                      ))}
                    </section>
                  )
                })
              ))}
            {state?.phase === "importing" && (
              <div role="status" className="flex items-center gap-2">
                <Spinner />
                {t("imports.importing")}
              </div>
            )}
            {(state?.phase === "importing" || state?.phase === "complete") && (
              <>
                <p role="status" className="text-sm">
                  {t("imports.summary", { success: successes.length, failed: failures.length })}
                </p>
                {successes.map((item, index) => (
                  <div key={index} className="flex items-start gap-2 text-sm">
                    <CheckIcon className="size-4 shrink-0" />
                    <span className="break-all">
                      {item.target ?? item.source ?? t(`imports.types.${item.itemType}`)}
                    </span>
                  </div>
                ))}
                {failures.map((item, index) => (
                  <Alert key={index} variant="destructive">
                    <AlertDescription>
                      {item.source}: {item.message}
                    </AlertDescription>
                  </Alert>
                ))}
              </>
            )}
            {state?.error && (
              <Alert variant="destructive">
                <AlertDescription>{state.error}</AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t(busy ? "imports.background" : "imports.close")}
            </Button>
            {state?.phase === "selecting" && (
              <Button disabled={selected.length === 0} onClick={() => send({ action: "import", indices: selected })}>
                <ArrowDownToLineIcon data-icon="inline-start" />
                {t("imports.selected", { count: selected.length })}
              </Button>
            )}
            {state?.phase === "error" && state.source && (
              <Button onClick={() => send({ action: "detect", source: state.source! })}>{t("imports.retry")}</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
