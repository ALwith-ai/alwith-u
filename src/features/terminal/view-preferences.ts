import type { TerminalSnapshot } from "@alwith/module-terminal"
import { terminalClient } from "@alwith/module-terminal/tauri"

import { openStore } from "@/lib/store"

type Descriptor = Pick<TerminalSnapshot, "terminalId" | "cwd" | "shell" | "title">
type Views = { version: 1; tabs: Descriptor[]; activeId: string | null }
const store = openStore("terminal-views")
/** Preferences contain view descriptors only, never commands, logs, environments or live process identities. */
export async function rememberTerminalViews(sessionId: string, activeId: string | null): Promise<void> {
  const tabs = (await terminalClient.list(sessionId))
    .filter((entry) => entry.interactive)
    .map(({ terminalId, cwd, shell, title }) => ({ terminalId, cwd, shell, title }))
  await store.set(sessionId, { version: 1, tabs, activeId } satisfies Views)
}
export async function restoreTerminalViews(sessionId: string): Promise<string | null> {
  const saved = await store.get<Views>(sessionId)
  if (!saved) return null
  if (
    saved.version !== 1 ||
    !Array.isArray(saved.tabs) ||
    (saved.activeId !== null && typeof saved.activeId !== "string")
  )
    throw new Error("Invalid terminal view preferences")
  const existing = await terminalClient.list(sessionId)
  for (const tab of saved.tabs) {
    if (
      ![tab.terminalId, tab.cwd, tab.shell, tab.title].every((value) => typeof value === "string" && value.length > 0)
    )
      throw new Error("Invalid terminal view descriptor")
    if (existing.some((entry) => entry.terminalId === tab.terminalId)) continue
    const registered = await terminalClient.register({
      sessionId,
      terminalId: tab.terminalId,
      cwd: tab.cwd,
      shell: tab.shell
    })
    if (registered.title !== tab.title) await terminalClient.rename(registered, tab.title)
  }
  return saved.activeId
}
export async function closeConversationTerminals(sessionId: string): Promise<void> {
  await terminalClient.closeSession(sessionId)
  await store.delete(sessionId)
}
