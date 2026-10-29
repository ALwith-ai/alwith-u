import { sessionGroup, QUICK_CHATS_GROUP, type ProjectContext } from "@nyssance/codex-acp-v2/client"

/** Preserve directory intent until the server's project context is available. */
export function newChatDirectory(cwd: string | null, context: ProjectContext | null): string | null {
  return cwd !== null && context && sessionGroup(context, {cwd}).id === QUICK_CHATS_GROUP ? null : cwd
}
