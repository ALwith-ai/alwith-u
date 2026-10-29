import { SessionStateMenu } from "@alwith/module-chat/session-list"
import type { SessionSummary } from "@nyssance/codex-acp-v2/client"
import { useTranslation } from "react-i18next"

import { useApp } from "@/lib/client"

export function SessionStatusMenu({ onSelect }: { onSelect: (row: SessionSummary) => void }) {
  const states = useApp((state) => state.runStates)
  const rows = useApp((state) => state.sessionList)
  const drafts = useApp((state) => state.draftSessions)
  const { t } = useTranslation("alwithChat")
  return (
    <SessionStateMenu
      sessions={Object.values(states).filter(
        (record) => !record.reusableDraft || drafts[record.sessionId] !== undefined
      )}
      t={t}
      onSelect={(record) =>
        onSelect(
          rows.find((row) => row.sessionId === record.sessionId) ?? {
            sessionId: record.sessionId,
            cwd: record.cwd,
            title: record.title || null,
            updatedAt: null,
            archived: false
          }
        )
      }
    />
  )
}
