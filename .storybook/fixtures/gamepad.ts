import type { Profile_Serialize, Request_Deserialize, Response_Serialize, Snapshot } from "@alwith/module-gamepad"
import { emit } from "@tauri-apps/api/event"
export type GamepadCase = "disconnected" | "connected" | "running" | "error"
let snapshot: Snapshot
let profile: Profile_Serialize = {
  id: "ps5",
  revision: 1,
  color: null,
  config: {
    deadzone: 0.15,
    poll_interval_ms: 16,
    mouse_move_scale: 1,
    buttons: {},
    left_stick: {},
    right_stick: {},
    overrides: []
  }
}
export function resetGamepad(kind: GamepadCase = "disconnected") {
  snapshot = {
    version: 1,
    generation: 1,
    sequence: 1,
    state: kind === "running" ? "running" : kind === "error" ? "failed" : "stopped",
    devices:
      kind === "disconnected"
        ? []
        : [
            {
              id: 1,
              name: "DualSense Wireless Controller",
              brand: "Sony",
              model: "ps5",
              battery: 80,
              charging: false,
              connection: "bluetooth"
            }
          ],
    activeDevice: kind === "disconnected" ? null : 1,
    activeProfile: kind === "disconnected" ? null : "ps5",
    savedRevision: 1,
    appliedRevision: 1,
    error: kind === "error" ? "模拟引擎连接失败" : ""
  }
}
export async function gamepadRequest(request: Request_Deserialize): Promise<Response_Serialize> {
  if (request.type === "loadProfile") return { type: "profile", profile: { ...profile, id: request.id } }
  if (request.type === "saveProfile") {
    profile = {
      ...profile,
      id: request.id,
      revision: profile.revision + 1,
      config: { ...profile.config, ...request.config } as Profile_Serialize["config"],
      color: request.color
    }
    return { type: "saved", profile, snapshot }
  }
  if (request.type === "start" || request.type === "stop")
    snapshot = { ...snapshot, sequence: snapshot.sequence + 1, state: request.type === "start" ? "running" : "stopped" }
  if (request.type === "selectDevice") snapshot = { ...snapshot, activeDevice: request.id }
  if (request.type === "activateProfile") snapshot = { ...snapshot, activeProfile: request.id }
  if (request.type === "snapshot") return { type: "snapshot", snapshot }
  await emit("gamepad:event", { type: "snapshot", snapshot })
  return { type: "ok" }
}
resetGamepad()
