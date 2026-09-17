import { AlertCircleIcon, SparklesIcon } from "lucide-react"
import { memo } from "react"
import { CodexAssistantTurn, CodexMessageActions } from "@alwith/module-chat/assistant-message"
import { ActivityHostProvider } from "@alwith/module-chat/activity-host"
import { useTranslation } from "react-i18next"
import type { Terminal, TurnError } from "@alwith/api"
import { codexTurnError } from "@/agent/codex-extensions"
import { messageText, type Turn, type WorkEntry } from "../turns"
import { ActivityGroup } from "./activity-group"
import { useChatActivityHost } from "./activity-host"
import { EditedFilesCard } from "./edited-files-card"
import { CodexMarkdownRenderer } from "./markdown-renderer"
import { CodexPlan } from "./plan"

function WorkEntryView({
  entry,
  terminals,
  streaming
}: {
  entry: WorkEntry
  terminals: Record<string, Terminal>
  streaming: boolean
}) {
  const { t } = useTranslation()
  switch (entry.kind) {
    case "activity":
      return <ActivityGroup items={entry.items} terminals={terminals} streaming={streaming} />
    case "text":
      return (
        <div className="codex-assistant-message">
          <CodexMarkdownRenderer text={messageText(entry.item)} streaming={streaming} />
        </div>
      )
    case "plan":
      return <CodexPlan plan={entry.item.plan} />
    case "compaction":
      return (
        <div className="codex-context-compaction">
          <SparklesIcon aria-hidden="true" />
          <span>{entry.item.status === "completed" ? t("chat.contextCompacted") : t("chat.compacting")}</span>
        </div>
      )
  }
}

export function TurnErrorView({ error }: { error: TurnError }) {
  const detail = codexTurnError(error)
  const { t } = useTranslation()
  return (
    <div className="codex-error-message" role="alert">
      <AlertCircleIcon aria-hidden="true" />
      <div className="min-w-0">
        <div>{detail.message}</div>
        {detail.retryable && <div className="text-(--codex-conversation-body)">{t("chat.error.retryable")}</div>}
      </div>
    </div>
  )
}

function AssistantTurnImpl({
  turn,
  terminals,
  active,
  isLast,
  error,
  interrupted
}: {
  turn: Turn
  terminals: Record<string, Terminal>
  active: boolean
  isLast: boolean
  error: TurnError | null
  interrupted: boolean
}) {
  const { t } = useTranslation()
  const host = useChatActivityHost()
  const finalText = turn.final.map(messageText).join("\n")
  const hasFinal = finalText.trim().length > 0
  return <ActivityHostProvider host={host}>
    <CodexAssistantTurn stateKey={turn.key} active={active} startedAt={turn.startedAt}
      durationMs={turn.replayed ? undefined : turn.endedAt - turn.startedAt}
      loading={active && turn.work.length === 0 && !hasFinal}
      work={turn.work.map(entry => <WorkEntryView key={entry.key} entry={entry} terminals={terminals} streaming={active} />)}
      answer={hasFinal ? <div className="codex-assistant-message">
        <CodexMarkdownRenderer text={finalText} streaming={active} />
        {!active && <CodexMessageActions text={finalText} isMostRecentTurn={isLast} />}
      </div> : null}
      footer={<>
        {turn.edits.length > 0 && !active && <EditedFilesCard items={turn.edits} />}
        {interrupted && <div className="codex-interrupted-turn">{t("chat.interrupted")}</div>}
        {error !== null && isLast && <TurnErrorView error={error} />}
      </>} />
  </ActivityHostProvider>
}

export const AssistantTurn = memo(AssistantTurnImpl)
