import type * as acp from "@agentclientprotocol/sdk/experimental/v2"
import { CodexPlan as SharedPlan } from "@alwith/chat/plan"
import { isPlanItems, isPlanMarkdown } from "@alwith/api"
import { CodexMarkdownRenderer } from "./markdown-renderer"

export function CodexPlan({ plan }: { plan: acp.PlanUpdateContent }) {
  if (isPlanMarkdown(plan)) {
    return (
      <div className="codex-reasoning-details">
        <CodexMarkdownRenderer text={plan.content} streaming={false} />
      </div>
    )
  }
  if (!isPlanItems(plan)) return null
  return <SharedPlan entries={plan.entries} />
}
