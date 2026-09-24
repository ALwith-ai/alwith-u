import type { Session } from "@alwith/api"
import { GitForkIcon } from "lucide-react"
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import type { ForkOrigin, ThreadSummary } from "@/agent/client"
import { codexExtensionCapabilities, codexTurnId } from "@/agent/codex-extensions"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import type { Turn } from "./turns"
import { client, useApp } from "@/lib/client"

type BranchActions = {
  sessionId: string
  canFork: boolean
  atTurn: boolean
  origin: ForkOrigin | undefined
  source: ThreadSummary | null
  sourceError: string | null
  sourceLoading: boolean
  retrySource: () => void
  pending: boolean
  fork: (turnId?: string) => void
  select: (thread: ThreadSummary) => void
}
const BranchContext = createContext<BranchActions | null>(null)

export function ChatBranchProvider({
  session,
  onSelect,
  children
}: {
  session: Session
  onSelect?: (thread: ThreadSummary) => void
  children: ReactNode
}) {
  const agent = useApp(state => state.agent)
  const connected = useApp(state => state.connection === "ready")
  const features = codexExtensionCapabilities(agent)
  const origin = useApp(state => state.forkOrigins[session.id])
  const [source, setSource] = useState<ThreadSummary | null>(null)
  const [sourceError, setSourceError] = useState<string | null>(null)
  const [sourceLoading, setSourceLoading] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const sourceId = origin?.sourceId
  // biome-ignore lint/correctness/useExhaustiveDependencies: a retry repeats the same source lookup.
  useEffect(() => {
    if (!sourceId) return
    let cancelled = false
    setSource(null)
    setSourceError(null)
    setSourceLoading(true)
    void client
      .readThreadSummary(sourceId)
      .then(value => {
        if (!cancelled) setSource(value)
      })
      .catch((error: unknown) => {
        if (!cancelled) setSourceError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (!cancelled) setSourceLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [sourceId, attempt])
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
  const fork = (turnId?: string) => {
    if (!canFork || busy.current) return
    busy.current = true
    setPending(true)
    void client
      .fork(session.id, session.cwd, turnId)
      .then(id => {
        const thread = client.state.threads.find(entry => entry.sessionId === id)
        if (!thread) throw new Error("Forked chat is missing from the session list")
        if (mounted.current) onSelect?.(thread)
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
          sessionId: session.id,
          canFork,
          atTurn: features.forkAtTurn,
          origin,
          source,
          sourceError,
          sourceLoading,
          retrySource: () => setAttempt(value => value + 1),
          pending,
          fork,
          select: onSelect
        }
  return <BranchContext value={value}>{children}</BranchContext>
}

export function ForkTurnButton({ turnId }: { turnId: string | null }) {
  const actions = useContext(BranchContext)
  const { t } = useTranslation()
  if (!actions?.atTurn || turnId === null) return null
  return (
    <Button
      variant="ghost"
      size="icon"
      className="codex-message-action focus-visible:ring-0 active:translate-y-0"
      aria-label={t("chat.branches.create")}
      title={t("chat.branches.create")}
      disabled={!actions.canFork || actions.pending}
      onClick={() => actions.fork(turnId)}>
      <GitForkIcon />
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
      : origin.boundaryTurnId !== null &&
        turn.items.some(item => "_meta" in item && codexTurnId(item._meta) === origin.boundaryTurnId)
  if (!atBoundary) return null
  return (
    <div className="flex items-center gap-3 py-4" data-fork-origin={origin.sourceId}>
      <Separator className="min-w-0 flex-1" />
      <Button
        variant="link"
        size="xs"
        className="text-muted-foreground max-w-[75%] min-w-0"
        title={actions.sourceError ?? actions.source?.title ?? undefined}
        disabled={actions.sourceLoading || (actions.source === null && actions.sourceError === null)}
        onClick={() => {
          if (actions.sourceError) actions.retrySource()
          else if (actions.source) actions.select(actions.source)
        }}>
        <GitForkIcon className="size-3.5" />
        <span className="shrink-0">{actions.sourceError ? t("actions.retry") : t("chat.branches.continuedFrom")}</span>
        <span className="truncate">
          {actions.source?.title ??
            (actions.sourceLoading ? t("chat.branches.loading") : t("chat.branches.sourceUnavailable"))}
        </span>
      </Button>
      <Separator className="min-w-0 flex-1" />
    </div>
  )
}
