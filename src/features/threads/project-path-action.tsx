import { ArrowUpRightIcon } from "lucide-react"
import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { OverflowMarquee } from "@/components/alwith-ui/overflow-marquee"
import { Button } from "@/components/ui/button"
import { ProjectAppIcon, useProjectApps } from "@/features/chat/open-in-editor"

/** Shared by project and session cards; opens the working directory itself. */
export function ProjectPathAction({
  cwd,
  onOpened,
  appearance = "project"
}: {
  cwd: string
  onOpened: () => void
  appearance?: "project" | "session"
}) {
  const { t } = useTranslation()
  const editor = useProjectApps(cwd)
  const [opening, setOpening] = useState(false)
  const openingRef = useRef(false)
  const open = async () => {
    if (openingRef.current) return
    openingRef.current = true
    setOpening(true)
    try {
      await editor.openPreferred()
      onOpened()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      openingRef.current = false
      setOpening(false)
    }
  }
  return (
    <Button
      data-slot={appearance === "session" ? "hover-info-card-action" : "button"}
      variant="ghost"
      size="sm"
      disabled={opening}
      aria-label={t("actions.openFolder")}
      title={editor.active ? `${t("actions.openProjectWith", { app: editor.active.name })}\n${cwd}` : cwd}
      className="group/path w-full min-w-0 justify-start gap-2 rounded-none border-0 px-3 font-normal active:not-aria-[haspopup]:translate-y-0"
      onClick={() => void open()}>
      <ProjectAppIcon app={editor.active} />
      <OverflowMarquee className="flex-1 text-start">{cwd}</OverflowMarquee>
      <span className="hover:bg-accent hover:text-accent-foreground invisible shrink-0 rounded-sm p-0.5 group-hover/path:visible group-focus-visible/path:visible">
        <ArrowUpRightIcon className="size-4" />
      </span>
    </Button>
  )
}
