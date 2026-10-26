import { ArrowRightIcon, LoaderCircleIcon, RocketIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"

import { useUpdaterStore } from "../store"

// Desktop's update card, placed in the footer flow so the screen switch stays accessible.
export function UpdateStatusButton() {
  const { t } = useTranslation()
  const state = useUpdaterStore((store) => store.state)
  const confirmInstallAndRelaunch = useUpdaterStore((store) => store.confirmInstallAndRelaunch)

  if (state.type === "downloading") {
    const total = state.totalBytes ?? 0
    const progress = total > 0 ? Math.min(((state.downloadedBytes ?? 0) / total) * 100, 100) : 0
    const label = t("updater.downloading", { percent: Math.round(progress) })
    return (
      <div className="flex h-12 w-full items-center gap-2 rounded-xl border bg-card p-2 shadow-lg" role="status">
        <svg
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
          viewBox="0 0 24 24"
          className="size-8 shrink-0 -rotate-90"
        >
          <circle cx="12" cy="12" r="9" pathLength="100" fill="none" className="stroke-muted" strokeWidth="2" />
          <circle
            cx="12"
            cy="12"
            r="9"
            pathLength="100"
            fill="none"
            className="stroke-foreground"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="100"
            strokeDashoffset={100 - progress}
          />
        </svg>
        <span className="truncate text-sm font-medium text-foreground">{label}</span>
      </div>
    )
  }

  if (state.type === "restarting") {
    return (
      <div className="flex h-12 w-full items-center gap-2 rounded-xl border bg-card p-2 shadow-lg" role="status">
        <LoaderCircleIcon className="size-8 shrink-0 animate-spin" aria-hidden="true" />
        <span className="truncate text-sm font-medium text-foreground">{t("updater.installing")}</span>
      </div>
    )
  }

  if (state.type !== "ready") return null

  return (
    <Button
      variant="outline"
      onClick={() => {
        void confirmInstallAndRelaunch().catch((error: unknown) =>
          toast.error(error instanceof Error ? error.message : String(error))
        )
      }}
      className="h-12 w-full justify-start gap-2 rounded-xl bg-card p-2 shadow-lg hover:bg-card dark:bg-card dark:hover:bg-card"
    >
      <span className="flex size-8 shrink-0 items-center justify-center">
        <RocketIcon className="size-6" />
      </span>
      <span className="min-w-0 flex-1 truncate text-start">
        <span className="block truncate text-sm font-medium text-foreground">{t("updater.install")}</span>
        <span className="block truncate text-xs font-normal text-muted-foreground">v{state.update.version}</span>
      </span>
      <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground rtl:-scale-x-100" />
    </Button>
  )
}
