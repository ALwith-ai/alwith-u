import { isQuickChatDirectory } from "@alwith/module-chat/session-list"

import { client } from "@/lib/client"

/** Null lets the host prepare the default workspace instead of inheriting a quick-chat directory. */
export function newChatDirectory(cwd: string | null): string | null {
  const context = client.state.projectContext
  return cwd !== null && context !== null && isQuickChatDirectory(cwd, context) ? null : cwd
}
