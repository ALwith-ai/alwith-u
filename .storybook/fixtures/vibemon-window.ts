import { vibemonHost } from "@alwith/module-auth/vibemon/core"
import type { VibemonWindowHost } from "@alwith/module-auth/vibemon/core"

import type { VibemonCollapseResult } from "../../src/features/vibemon/collapse"
export async function registerVibemonSurface() {}
export async function restoreVibemonAfterChat() {}
export async function suspendVibemonForChat() {}
export async function collapseChatToVibemon(): Promise<VibemonCollapseResult> {
  const owned = await vibemonHost().assets.getMyVibemons()
  return { type: "setup", view: owned.length > 0 ? "equip" : "pull" }
}
export function vibemonWindowCall<T>(): Promise<T> {
  return Promise.resolve(undefined as T)
}
export function createVibemonWindowClient(): VibemonWindowHost {
  return {
    call: vibemonWindowCall,
    openVibemon: () => Promise.resolve("unavailable"),
    closeVibemon: async () => {},
    openRecharge: async () => {},
    geometry: () => Promise.resolve(() => {}),
    moved: () => Promise.resolve(() => {}),
    commands: () => () => {}
  }
}
