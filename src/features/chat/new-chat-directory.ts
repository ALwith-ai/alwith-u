import { useThreadsUiStore } from "@/features/threads/store"
import { isQuickChatDirectory } from "@/features/threads/thread-groups"

/** Null lets the host prepare the default workspace instead of inheriting a quick-chat directory. */
export function newChatDirectory(cwd: string | null): string | null {
  return cwd !== null && isQuickChatDirectory(cwd, useThreadsUiStore.getState().windowsTempDirectory) ? null : cwd
}
