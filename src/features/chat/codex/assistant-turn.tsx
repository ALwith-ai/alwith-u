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
import { AlertCircleIcon, SparklesIcon } from "lucide-react"
import { memo } from "react"
import type { ContentBlock } from "@agentclientprotocol/sdk/experimental/v2"
import { useTranslation } from "react-i18next"
import { codexTurnError, codexTurnId } from "@/agent/codex-extensions"
import { ForkTurnButton } from "../chat-branches"
import { messageText, type Turn, type WorkEntry } from "../turns"
import { ActivityGroup } from "./activity-group"
import { useChatActivityHost } from "./activity-host"
import { AssistantContent } from "./assistant-content"
import { EditedFilesCard } from "./edited-files-card"
import { CodexPlan } from "./plan"
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
      return <AssistantContent content={entry.item.content} messageId={entry.item.id} streaming={streaming} />
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
  const time = active ? null : formatTurnTime(turn)
  // Generated artifacts are tool results in both live updates and history replay.
  // Project them into the reply without moving items out of the runtime-owned session.
  const displayedImages = new Set(
    turn.final.flatMap(message => message.content.map(imageIdentity).filter(identity => identity !== null))
  )
  const artifacts = turn.items.flatMap(item => {
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
    turn.final.some(message => message.content.some(block => !isText(block) || block.text.trim().length > 0))
  return (
    <ActivityHostProvider host={host}>
      <CodexAssistantTurn
        stateKey={turn.key}
        active={active}
        startedAt={turn.startedAt}
        durationMs={turn.replayed ? undefined : turn.endedAt - turn.startedAt}
        loading={active && turn.work.length === 0 && !hasFinal}
        work={turn.work.map(entry => (
          <WorkEntryView key={entry.key} entry={entry} terminals={terminals} streaming={active} />
        ))}
        answer={
          hasFinal ? (
            <div className="flex min-w-0 flex-col items-start gap-3">
              {artifacts.length > 0 && (
                <div className="codex-reply-artifacts flex min-w-0 flex-col gap-3">
                  {artifacts.map(artifact => (
                    <AssistantContent
                      key={artifact.key}
                      content={[artifact.block]}
                      messageId={artifact.key}
                      streaming={false}
                    />
                  ))}
                </div>
              )}
              {turn.final.map(message => (
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
            {turn.edits.length > 0 && !active && <EditedFilesCard items={turn.edits} />}
            {interrupted && <div className="codex-interrupted-turn">{t("chat.interrupted")}</div>}
            {error !== null && isLast && <TurnErrorView error={error} />}
          </>
        }
      />
    </ActivityHostProvider>
  )
}

export const AssistantTurn = memo(AssistantTurnImpl)
