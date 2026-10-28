import type { Item, Session } from "@alwith/api"
import type { Turn } from "@alwith/module-chat/turns"
import { codexExtensionCapabilities, codexTurnId } from "@nyssance/codex-acp-v2/client"
import { SplitIcon } from "lucide-react"
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import type { ForkOrigin, SessionSummary } from "@/agent/client"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { client, useApp } from "@/lib/client"

type BranchActions = {
  canFork: boolean
  atTurn: boolean
  origin: ForkOrigin | undefined
  boundaryItem: Item | undefined
  openingSource: boolean
  openSource: () => void
  pending: boolean
  fork: (turnId?: string) => void
}
const BranchContext = createContext<BranchActions | null>(null)

export function ChatBranchProvider({
  session,
  onSelect,
  children
}: {
  session: Session
  onSelect?: (sessionRow: SessionSummary) => void
  children: ReactNode
}) {
  const agent = useApp((state) => state.agent)
  const connected = useApp((state) => state.connection === "ready")
  const features = codexExtensionCapabilities(agent)
  const origin = useApp((state) => state.forkOrigins[session.id])
  // A native turn may contain several user messages and therefore several UI batches.
  // Only its final item owns the marker, not every batch with the same turn id.
  const boundaryItem = session.items.findLast(
    (item) => origin?.boundaryTurnId != null && codexTurnId(item._meta) === origin.boundaryTurnId
  )
  const { t } = useTranslation()
  const [openingSource, setOpeningSource] = useState(false)
  const sourceBusy = useRef(false)
  const [pending, setPending] = useState(false)
  const busy = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const canFork =
    onSelect !== undefined &&
    connected &&
    !session.restoring &&
    session.state === "idle" &&
    agent?.capabilities?.session?.fork != null
  const openSource = () => {
    if (!origin || !onSelect || !connected || sourceBusy.current) return
    sourceBusy.current = true
    setOpeningSource(true)
    void client
      .readSessionSummary(origin.sourceId)
      .then((sessionRow) => {
        if (!mounted.current) return
        if (!sessionRow) throw new Error(t("chat.branches.sourceUnavailable"))
        onSelect(sessionRow)
      })
      .catch((error: unknown) => {
        if (mounted.current) toast.error(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        sourceBusy.current = false
        if (mounted.current) setOpeningSource(false)
      })
  }
  const fork = (turnId?: string) => {
    if (!canFork || busy.current) return
    busy.current = true
    setPending(true)
    void client
      .fork(session.id, session.cwd, turnId)
      .then((id) => {
        const sessionRow = client.state.sessionList.find((entry) => entry.sessionId === id)
        if (!sessionRow) throw new Error("Forked chat is missing from the session list")
        if (mounted.current) onSelect?.(sessionRow)
      })
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : String(error)))
      .finally(() => {
        busy.current = false
        if (mounted.current) setPending(false)
      })
  }
  const value =
    onSelect === undefined
      ? null
      : {
          canFork,
          atTurn: features.forkAtTurn,
          origin,
          boundaryItem,
          openingSource: openingSource || !connected,
          openSource,
          pending,
          fork
        }
  return <BranchContext value={value}>{children}</BranchContext>
}

export function ForkTurnButton({ turnId, labelled = false }: { turnId: string | null; labelled?: boolean }) {
  const actions = useContext(BranchContext)
  const { t } = useTranslation()
  const label = t(labelled ? "chat.readOnly.fork" : "chat.branches.create")
  if (!actions?.atTurn || turnId === null) return null
  return (
    <Button
      variant={labelled ? "outline" : "ghost"}
      size={labelled ? "sm" : "icon"}
      className={
        labelled
          ? "cursor-pointer text-foreground focus-visible:ring-0 active:translate-y-0 disabled:cursor-not-allowed"
          : "codex-message-action focus-visible:ring-0 active:translate-y-0"
      }
      aria-label={label}
      title={label}
      disabled={!actions.canFork || actions.pending}
      onClick={() => actions.fork(turnId)}
    >
      {!labelled && <SplitIcon className="rotate-90" />}
      {labelled && label}
    </Button>
  )
}

/** The marker stays at the inherited turn, even as this branch grows. */
export function ForkOriginDivider({ turn }: { turn?: Turn }) {
  const actions = useContext(BranchContext)
  const { t } = useTranslation()
  const origin = actions?.origin
  if (!actions || !origin) return null
  const atBoundary =
    turn === undefined
      ? origin.boundaryTurnId === null
      : actions.boundaryItem !== undefined && turn.items.includes(actions.boundaryItem)
  if (!atBoundary) return null
  return (
    <div className="flex items-center gap-3 py-4" data-fork-origin={origin.sourceId}>
      <Separator className="min-w-0 flex-1" />
      <Button
        variant="link"
        size="xs"
        className="max-w-[75%] min-w-0 text-muted-foreground"
        disabled={actions.openingSource}
        onClick={actions.openSource}
      >
        <SplitIcon className="size-3.5 rotate-90" />
        <span>{t("chat.branches.continuedFrom")}</span>
      </Button>
      <Separator className="min-w-0 flex-1" />
    </div>
  )
}
