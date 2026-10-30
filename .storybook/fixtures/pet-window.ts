import { vibemonHost } from "@alwith/module-auth/pets/core"
import type { PetWindowHost } from "@alwith/module-auth/pets/core"

import type { PetCollapseResult } from "../../src/features/vibemon/collapse"
export async function registerPetSurface() {}
export async function restorePetAfterChat() {}
export async function suspendPetForChat() {}
export async function collapseChatToPet(): Promise<PetCollapseResult> {
  const owned = await vibemonHost().assets.getMyVibemons()
  return { type: "setup", view: owned.length > 0 ? "equip" : "pull" }
}
export async function petWindowCall<T>(): Promise<T> {
  return undefined as T
}
export function createPetWindowClient(): PetWindowHost {
  return {
    call: petWindowCall,
    openPet: async () => "unavailable",
    closePet: async () => {},
    openRecharge: async () => {},
    geometry: async () => () => {},
    moved: async () => () => {},
    commands: () => () => {}
  }
}
