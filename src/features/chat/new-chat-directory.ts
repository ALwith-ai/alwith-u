import { isQuickChatDirectory } from "@alwith/module-chat/session-list"

/** Null lets the host prepare the default workspace instead of inheriting a quick-chat directory. */
export function newChatDirectory(cwd: string | null): string | null {
  return cwd !== null && isQuickChatDirectory(cwd) ? null : cwd
}
