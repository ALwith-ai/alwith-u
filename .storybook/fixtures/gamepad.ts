import type {
  Microphone,
  Privacy,
  Profile_Serialize,
  Request_Deserialize,
  Response_Serialize,
  ServiceEvent,
  Snapshot
} from "@alwith/module-gamepad"
import type { Channel } from "@tauri-apps/api/core"
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
const subscribers = new Map<number, Channel<ServiceEvent>>()
let nextSubscription = 1
const privacy: Privacy = { authorized: true, mayPrompt: false }
const microphones: Microphone[] = [{ name: "MacBook Pro 麦克风", default: true }]
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
    error: kind === "error" ? "模拟引擎连接失败" : null
  }
}
function gamepadRequest(request: Request_Deserialize): Response_Serialize {
  if (request.type === "loadProfile") return { type: "profile", profile: { ...profile, id: request.id } }
  if (request.type === "saveProfile") {
    profile = {
      ...profile,
      id: request.id,
      revision: profile.revision + 1,
      config: { ...profile.config, ...request.config } as Profile_Serialize["config"],
      color: request.color ?? null
    }
    return { type: "saved", profile, snapshot }
  }
  if (request.type === "start" || request.type === "stop")
    snapshot = { ...snapshot, sequence: snapshot.sequence + 1, state: request.type === "start" ? "running" : "stopped" }
  if (request.type === "selectDevice") snapshot = { ...snapshot, activeDevice: request.id ?? null }
  if (request.type === "activateProfile") snapshot = { ...snapshot, activeProfile: request.id }
  if (request.type === "snapshot") return { type: "snapshot", snapshot }
  for (const events of subscribers.values()) events.onmessage({ type: "snapshot", snapshot })
  return { type: "ok" }
}
/** The `alwith-gamepad` plugin's commands; engine events reach each subscribed webview channel. */
export function gamepadCommand(command: string, args: Record<string, unknown>): unknown {
  if (command === "plugin:alwith-gamepad|request") return gamepadRequest(args.request as Request_Deserialize)
  if (command === "plugin:alwith-gamepad|subscribe") {
    const id = nextSubscription++
    subscribers.set(id, args.events as Channel<ServiceEvent>)
    return id
  }
  if (command === "plugin:alwith-gamepad|unsubscribe") {
    if (!subscribers.delete(args.id as number)) throw new Error(`Unknown gamepad subscription: ${String(args.id)}`)
    return null
  }
  if (command === "plugin:alwith-gamepad|permission_status" || command === "plugin:alwith-gamepad|request_permission")
    return privacy
  if (command === "plugin:alwith-gamepad|microphones") return microphones
  if (command === "plugin:alwith-gamepad|capture_start" || command === "plugin:alwith-gamepad|capture_stop") return null
  throw new Error(`Unimplemented Storybook gamepad boundary: ${command}`)
}
resetGamepad()
