import { commands } from "@/bindings"
import { settingsStore, updateSettings } from "@/lib/settings-store"

/** Native authority is application-wide; every session refreshes tools before its next prompt. */
export async function enableComputer(): Promise<void> {
  await commands.computerStart()
  try {
    await updateSettings({ "computer.enabled": true })
  } catch (error) {
    await commands.computerStop()
    throw error
  }
}

/** Closing the shared driver revokes every MCP connection without cancelling unrelated chat work. */
export async function stopComputer(): Promise<void> {
  await commands.computerStop()
  await updateSettings({ "computer.enabled": false })
}

/** Restore a saved choice only when the OS still grants both required permissions. */
export async function restoreComputer(): Promise<void> {
  if (settingsStore.get<boolean>("computer.enabled") !== true) return
  const status = await commands.computerStatus()
  if (status.enabled || !status.available || !status.permissions.supported) return
  if (!status.permissions.accessibility || !status.permissions.screenCapture) return
  await commands.computerStart()
}
