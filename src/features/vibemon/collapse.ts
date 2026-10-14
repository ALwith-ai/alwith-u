export type PetCollapseResult = { type: "shown" } | { type: "setup"; view: "pull" | "equip" }

export interface PetCollapseHost {
  validate(): void
  equippedPet(): Promise<string>
  hasPets(): Promise<boolean>
  showPet(): Promise<void>
  bindSession(): Promise<void>
  openBubble(): Promise<void>
  hideChat(): Promise<void>
  restoreChat(): Promise<void>
}

/** Keep the chat visible until its replacement is ready; never bind an unprepared pet. */
export async function collapseToPet(host: PetCollapseHost): Promise<PetCollapseResult> {
  host.validate()
  const equipped = await host.equippedPet()
  host.validate()
  if (!equipped) {
    const hasPets = await host.hasPets()
    host.validate()
    return { type: "setup", view: hasPets ? "equip" : "pull" }
  }
  await host.showPet()
  host.validate()
  await host.bindSession()
  await host.openBubble()
  host.validate()
  try {
    await host.hideChat()
  } catch (error) {
    await host.restoreChat()
    throw error
  }
  return { type: "shown" }
}
