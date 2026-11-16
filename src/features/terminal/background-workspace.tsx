import { type BackgroundTerminal, terminalOf } from "@alwith/module-chat/client"
import { SquareIcon, XIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { client, useSession } from "@/lib/client"
import { text } from "@/lib/text"

function report(error: unknown) {
  toast.error(text(error))
}
function useBackgroundTerminals(sessionId: string | null) {
  const session = useSession(sessionId)
  const [entries, setEntries] = useState<BackgroundTerminal[]>([])
  const attached = session?.attached === true && !session.restoring
  useEffect(() => {
    setEntries([])
    if (sessionId === null || !attached) return
    let disposed = false,
      timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const next = await client.listBackgroundTerminals(sessionId)
        if (!disposed) setEntries(next)
      } catch (error) {
        if (!disposed) report(error)
      } finally {
        if (!disposed)
          timer = setTimeout(() => {
            void poll()
          }, 2000)
      }
    }
    void poll()
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [sessionId, attached])
  return entries
}
export function BackgroundWorkspacePane({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const entries = useBackgroundTerminals(sessionId),
    session = useSession(sessionId),
    { t } = useTranslation()
  const [selected, setSelected] = useState<BackgroundTerminal | null>(null),
    [stopping, setStopping] = useState(false)
  useEffect(() => {
    if (selected === null && entries[0]) setSelected(entries[0])
  }, [entries, selected])
  const active = selected ?? entries[0] ?? null
  const tool = session?.items.find((item) => item.kind === "tool" && item.id === active?.itemId)
  const output = tool?.kind === "tool" && session ? (terminalOf(tool, session.terminals)?.output ?? "") : ""
  const stop = async () => {
    setStopping(true)
    try {
      const result = await client.stopBackgroundTerminals(sessionId)
      if (result.failures.length) throw new Error(result.failures.map((failure) => failure.message).join("\n"))
    } catch (error) {
      report(error)
    } finally {
      setStopping(false)
    }
  }
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex items-center gap-2 border-b p-2">
        <span className="flex-1 text-sm">{t("terminal.background")}</span>
        <Button
          variant="ghost"
          size="sm"
          disabled={stopping || entries.length === 0}
          onClick={() => {
            void stop()
          }}
        >
          <SquareIcon className="size-3" />
          {t("terminal.stopAllBackground")}
        </Button>
        <Button variant="ghost" size="icon-xs" aria-label={t("terminal.hide")} onClick={onClose}>
          <XIcon className="size-4" />
        </Button>
      </div>
      <div className="flex flex-wrap gap-1 border-b p-2">
        {entries.map((entry) => (
          <Button
            key={entry.processId}
            size="sm"
            variant={active?.processId === entry.processId ? "secondary" : "ghost"}
            onClick={() => setSelected(entry)}
          >
            {entry.command}
          </Button>
        ))}
      </div>
      {active ? (
        <>
          <div className="truncate px-3 py-2 font-mono text-xs text-muted-foreground">{active.command}</div>
          <pre
            tabIndex={0}
            className="min-h-0 flex-1 overflow-auto p-3 font-mono text-xs break-all whitespace-pre-wrap"
            aria-label={t("terminal.output")}
          >
            {output}
          </pre>
        </>
      ) : (
        <div className="p-3 text-sm text-muted-foreground">{t("terminal.noBackground")}</div>
      )}
    </div>
  )
}
