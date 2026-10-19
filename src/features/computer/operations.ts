import { commands } from "@/bindings"

/** Native authority is application-wide; every session refreshes tools before its next prompt. */
export async function enableComputer(): Promise<void> {
  await commands.computerStart()
}

/** Closing the shared driver revokes every MCP connection without cancelling unrelated chat work. */
export async function stopComputer(): Promise<void> {
  await commands.computerStop()
}
