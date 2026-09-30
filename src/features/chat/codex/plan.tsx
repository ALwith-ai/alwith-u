import type * as acp from "@agentclientprotocol/sdk/experimental/v2"
import { isPlanItems, isPlanMarkdown } from "@alwith/api"
import { CodexPlan as SharedPlan } from "@alwith/module-chat/plan"
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
