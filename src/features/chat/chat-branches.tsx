import type { Session } from "@alwith/api"
import { CheckIcon, GitForkIcon, Loader2Icon, PlusIcon } from "lucide-react"
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import type { ThreadSummary } from "@/agent/client"
import { codexExtensionCapabilities } from "@/agent/codex-extensions"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { client, useApp } from "@/lib/client"

type BranchActions = {
  sessionId: string
  canFork: boolean
  atTurn: boolean
  lineage: boolean
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
          lineage: features.sessionLineage,
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
      className="size-6 rounded-md [&_svg]:size-3.5"
      aria-label={t("chat.branches.create")}
      title={t("chat.branches.create")}
      disabled={!actions.canFork || actions.pending}
      onClick={() => actions.fork(turnId)}>
      <GitForkIcon />
    </Button>
  )
}

export function ChatBranchMenu() {
  const actions = useContext(BranchContext)
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<ThreadSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const sessionId = actions?.sessionId
  const lineage = actions?.lineage
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry explicitly restarts the same read.
  useEffect(() => {
    if (!open || !lineage || sessionId === undefined) return
    let cancelled = false
    setResult(null)
    setError(null)
    void client
      .listBranches(sessionId)
      .then(threads => {
        if (!cancelled) setResult(threads)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      cancelled = true
    }
  }, [open, lineage, sessionId, attempt])
  if (!actions || (!actions.lineage && !actions.canFork)) return null
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("chat.branches.label")}
            title={t("chat.branches.label")}
          />
        }>
        <GitForkIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 w-72 overflow-y-auto">
        <DropdownMenuItem disabled={!actions.canFork || actions.pending} onClick={() => actions.fork()}>
          <PlusIcon />
          {t("chat.branches.create")}
        </DropdownMenuItem>
        {actions.lineage && (
          <>
            <DropdownMenuSeparator />
            {error !== null ? (
              <>
                <div role="alert" className="text-destructive px-2 py-1 text-xs">
                  {error}
                </div>
                <DropdownMenuItem
                  onClick={event => {
                    event.preventDefault()
                    setAttempt(value => value + 1)
                  }}>
                  {t("actions.retry")}
                </DropdownMenuItem>
              </>
            ) : result === null ? (
              <div role="status" className="text-muted-foreground flex items-center gap-2 px-2 py-2 text-sm">
                <Loader2Icon className="size-4 animate-spin" />
                {t("chat.branches.loading")}
              </div>
            ) : (
              result.map(thread => (
                <DropdownMenuItem
                  key={thread.sessionId}
                  disabled={actions.pending}
                  onClick={() => {
                    if (thread.sessionId !== actions.sessionId) actions.select(thread)
                  }}>
                  <CheckIcon className={thread.sessionId === actions.sessionId ? "size-4" : "invisible size-4"} />
                  <span className="min-w-0 flex-1 truncate">{thread.title ?? t("sidebar.untitled")}</span>
                  <span className="text-muted-foreground text-xs">
                    {thread.sessionId === actions.sessionId ? t("chat.branches.current") : thread.sessionId.slice(-6)}
                  </span>
                </DropdownMenuItem>
              ))
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
