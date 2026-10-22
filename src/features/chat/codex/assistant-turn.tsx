import type { ContentBlock } from "@agentclientprotocol/sdk/experimental/v2/unstable"
import {
  isContentEntry,
  isEmbeddedResource,
  isImage,
  isResourceLink,
  isText,
  type Terminal,
  type TurnError
} from "@alwith/api"
import { ActivityHostProvider } from "@alwith/module-chat/activity-host"
import { CodexAssistantTurn, CodexMessageActions } from "@alwith/module-chat/assistant-message"
import { SparklesIcon } from "lucide-react"
import { memo } from "react"
import { useTranslation } from "react-i18next"

import { codexMessageError, codexTurnError, codexTurnId } from "@/agent/codex-extensions"
import { nativeTurnId } from "@/agent/history-navigation"

import { ForkTurnButton } from "../chat-branches"
import { isHistoryInterrupted, isSessionStatus, messageText, type Turn, turnTiming, type WorkEntry } from "../turns"
import { ActivityGroup } from "./activity-group"
import { useChatActivityHost } from "./activity-host"
import { AssistantContent } from "./assistant-content"
import { EditedFilesCard } from "./edited-files-card"
import { CodexPlan } from "./plan"
import { ErrorCard, TurnErrorView, type TurnRetry } from "./turn-error"
import { formatTurnTime } from "./turn-time"

function imageIdentity(block: ContentBlock): string | null {
  if (isImage(block)) return `${block.mimeType.toLowerCase()}:${block.data}`
  if (
    isEmbeddedResource(block) &&
    "blob" in block.resource &&
    block.resource.mimeType?.toLowerCase().startsWith("image/")
  )
    return `${block.resource.mimeType.toLowerCase()}:${block.resource.blob}`
  return null
}

function WorkEntryView({
  entry,
  terminals,
  streaming,
  streamingThoughtId
}: {
  entry: WorkEntry
  terminals: Record<string, Terminal>
  streaming: boolean
  streamingThoughtId: string | null
}) {
  const { t } = useTranslation()
  switch (entry.kind) {
    case "activity":
      return <ActivityGroup items={entry.items} terminals={terminals} streamingThoughtId={streamingThoughtId} />
    case "text":
      return <AssistantContent content={entry.item.content} messageId={entry.item.id} streaming={streaming} />
    case "plan":
      return <CodexPlan plan={entry.item.plan} />
    case "compaction":
      if (entry.item.status === "failed") {
        return (
          <ErrorCard>
            <div>{t("chat.compactionFailed")}</div>
            {entry.item.error !== null && <div>{entry.item.error}</div>}
          </ErrorCard>
        )
      }
      return (
        <div className="codex-context-compaction">
          <SparklesIcon aria-hidden="true" />
          <span>{entry.item.status === "completed" ? t("chat.contextCompacted") : t("chat.compacting")}</span>
        </div>
      )
  }
}

function AssistantTurnImpl({
  turn,
  terminals,
  active,
  isLast,
  error,
  interrupted,
  retry,
  retrying
}: {
  turn: Turn
  terminals: Record<string, Terminal>
  active: boolean
  isLast: boolean
  error: TurnError | null
  interrupted: boolean
  retry?: TurnRetry
  retrying?: { message: string; capacity: boolean }
}) {
  const { t } = useTranslation()
  const host = useChatActivityHost()
  const errors = turn.errors.map((item) => {
    const failure = codexMessageError(item)
    if (failure === null) throw new Error("Turn error item is missing its diagnostics")
    const action = retry?.turnId === nativeTurnId(item) ? retry : undefined
    return <TurnErrorView key={`${item.id}:${action?.delaySeconds ?? "manual"}`} error={failure} retry={action} />
  })
  if (
    isLast &&
    error !== null &&
    !turn.errors.some((item) => {
      const failure = codexMessageError(item)
      return (
        failure !== null &&
        failure.stopReason === error.stopReason &&
        codexTurnError(failure).message === codexTurnError(error).message
      )
    })
  )
    errors.push(<TurnErrorView key="current-run-error" error={error} />)
  const errorCards = errors.length > 0 ? <div className="codex-turn-errors">{errors}</div> : null
  const completedCompactions = turn.work.filter(
    (entry) => entry.kind === "compaction" && entry.item.status === "completed"
  )
  const work = turn.work.filter((entry) => !completedCompactions.includes(entry))
  const compactionOnly = completedCompactions.length > 0 && work.length === 0 && turn.final.length === 0
  if (isSessionStatus(turn) || compactionOnly) {
    return (
      <ActivityHostProvider host={host}>
        <div role="status" className="flex min-w-0 flex-col gap-2 py-2 text-sm text-muted-foreground">
          {turn.work.map((entry) => (
            <WorkEntryView
              key={entry.key}
              entry={entry}
              terminals={terminals}
              streaming={false}
              streamingThoughtId={null}
            />
          ))}
        </div>
        {errorCards}
      </ActivityHostProvider>
    )
  }
  const historyInterrupted = isHistoryInterrupted(turn)
  // Codex streams reasoning only while it is the latest non-user item in the turn.
  // Use item order, not arrival timestamps: patches to earlier items do not resume them.
  const latestItem = turn.items.findLast((item) => item.kind !== "user")
  const streamingThoughtId = active && latestItem?.kind === "thought" ? latestItem.id : null
  const finalText = turn.final.map(messageText).join("\n")
  const time = active ? null : formatTurnTime(turn, "assistant")
  // Generated artifacts are tool results in both live updates and history replay.
  // Project them into the reply without moving items out of the runtime-owned session.
  const displayedImages = new Set(
    turn.final.flatMap((message) => message.content.map(imageIdentity).filter((identity) => identity !== null))
  )
  const artifacts = turn.items.flatMap((item) => {
    if (item.kind !== "tool" || item.status !== "completed") return []
    return item.content.filter(isContentEntry).flatMap((part, index) => {
      const block = part.content
      const image = item.name === "image_generation" && isImage(block)
      const file =
        item.toolKind !== "read" &&
        item.toolKind !== "search" &&
        (isResourceLink(block) || (isEmbeddedResource(block) && "blob" in block.resource))
      if (!image && !file) return []
      const identity = imageIdentity(block)
      if (identity !== null) {
        if (displayedImages.has(identity)) return []
        displayedImages.add(identity)
      }
      return [{ key: `${item.id}:${index}`, block }]
    })
  })
  const hasFinal =
    artifacts.length > 0 ||
    turn.final.some((message) => message.content.some((block) => !isText(block) || block.text.trim().length > 0))
  return (
    <ActivityHostProvider host={host}>
      <CodexAssistantTurn
        stateKey={turn.key}
        active={active}
        {...turnTiming(turn)}
        loading={active && turn.work.length === 0 && !hasFinal && retrying === undefined}
        work={work.map((entry) => (
          <WorkEntryView
            key={entry.key}
            entry={entry}
            terminals={terminals}
            streaming={active}
            streamingThoughtId={streamingThoughtId}
          />
        ))}
        answer={
          hasFinal ? (
            <div className="flex min-w-0 flex-col gap-3">
              {artifacts.length > 0 && (
                <div className="codex-reply-artifacts flex min-w-0 flex-col gap-3">
                  {artifacts.map((artifact) => (
                    <AssistantContent
                      key={artifact.key}
                      content={[artifact.block]}
                      messageId={artifact.key}
                      streaming={false}
                    />
                  ))}
                </div>
              )}
              {turn.final.map((message) => (
                <AssistantContent
                  key={message.id}
                  content={message.content}
                  messageId={message.id}
                  streaming={active}
                />
              ))}
              {!active &&
                (finalText.trim().length > 0 ? (
                  <CodexMessageActions
                    text={finalText}
                    isMostRecentTurn={isLast}
                    time={time}
                    afterCopy={<ForkTurnButton turnId={codexTurnId(turn.final.at(-1)?._meta)} />}
                  />
                ) : (
                  <div className="flex items-center gap-0.5">
                    <ForkTurnButton turnId={codexTurnId(turn.final.at(-1)?._meta)} />
                    {time && (
                      <span className="codex-user-time ms-1" title={time.full}>
                        {time.short}
                      </span>
                    )}
                  </div>
                ))}
            </div>
          ) : null
        }
        footer={
          <>
            {completedCompactions.map((entry) => (
              <WorkEntryView
                key={entry.key}
                entry={entry}
                terminals={terminals}
                streaming={false}
                streamingThoughtId={null}
              />
            ))}
            {turn.edits.length > 0 && !active && <EditedFilesCard items={turn.edits} />}
            {(interrupted || historyInterrupted) && (
              <div className="codex-interrupted-turn" role="status">
                {t(historyInterrupted ? "chat.historyInterrupted" : "chat.interrupted")}
              </div>
            )}
            {!active && errorCards}
          </>
        }
      />
      {active && retrying !== undefined && (
        <div className="py-2 text-sm text-muted-foreground" role="status">
          {retrying.capacity
            ? (() => {
                const progress = /Reconnecting(?:\.\.\.)?\s+(\d+\/\d+)/.exec(retrying.message)?.[1]
                return progress === undefined
                  ? t("chat.error.capacityReconnecting")
                  : t("chat.error.capacityReconnectingProgress", { progress })
              })()
            : retrying.message}
        </div>
      )}
      {active && errorCards}
    </ActivityHostProvider>
  )
}

export const AssistantTurn = memo(AssistantTurnImpl)
