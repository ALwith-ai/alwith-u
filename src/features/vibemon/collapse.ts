export type VibemonCollapseResult = { type: "shown" } | { type: "setup"; view: "pull" | "equip" }

export interface VibemonCollapseHost {
  validate: () => void
  equippedVibemon: () => Promise<string>
  hasVibemon: () => Promise<boolean>
  showVibemon: () => Promise<void>
  bindSession: () => Promise<void>
  hideChat: () => Promise<void>
  restoreChat: () => Promise<void>
}

/** Keep the chat visible until its replacement is ready; never bind an unprepared vibemon. */
export async function collapseToVibemon(host: VibemonCollapseHost): Promise<VibemonCollapseResult> {
  host.validate()
  const equipped = await host.equippedVibemon()
  host.validate()
  if (!equipped) {
    const hasVibemon = await host.hasVibemon()
    host.validate()
    return { type: "setup", view: hasVibemon ? "equip" : "pull" }
  }
  await host.showVibemon()
  host.validate()
  await host.bindSession()
  host.validate()
  try {
    await host.hideChat()
  } catch (error) {
    await host.restoreChat()
    throw error
  }
  return { type: "shown" }
}
