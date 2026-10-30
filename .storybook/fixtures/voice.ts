import type { AudioCapture, VoiceEvent } from "@alwith/module-voice"
import { Channel } from "@tauri-apps/api/core"
export type VoiceCase =
  "disabled" | "idle" | "starting" | "recording" | "transcribing" | "error" | "unconfigured" | "noSpeech"
let mode: VoiceCase = "disabled"
let receiver: Channel<VoiceEvent> | null = null
let recordingId = ""
export function resetVoice(kind: VoiceCase = "disabled"): void {
  mode = kind
  receiver = null
  recordingId = ""
}
export function voiceRequest(command: string, args: Record<string, unknown>): unknown {
  if (command === "voice_profiles") return { vui: mode !== "unconfigured", doubao: mode !== "unconfigured" }
  if (command === "voice_list_devices") return [{ id: "default", name: "MacBook Pro 麦克风", isDefault: true }]
  if (command === "voice_start") {
    receiver = args.events as Channel<VoiceEvent>
    recordingId = (args.options as { recordingId: string }).recordingId
    if (mode === "starting") return new Promise(() => {})
    receiver.onmessage({ type: "ready", recordingId })
    return
  }
  if (command === "voice_push") return
  if (command === "voice_control") {
    if (args.action === "finish") {
      if (mode === "transcribing") return
      if (mode === "error")
        receiver?.onmessage({ type: "failed", recordingId, message: "模拟语音识别服务连接失败，请重试。" })
      else
        receiver?.onmessage({ type: "final", recordingId, text: mode === "noSpeech" ? "" : "请整理本周项目交付进度" })
    }
    if (args.action === "cancel") receiver?.onmessage({ type: "cancelled", recordingId })
    return
  }
  if (command === "voice_delete_credential") return
  throw new Error(`Unimplemented voice boundary: ${command}`)
}
// Synthetic capture replaces microphone hardware only; the shared voice interaction remains real.
export async function prepareCapture(_options: unknown, signal: AbortSignal): Promise<AudioCapture> {
  signal.throwIfAborted()
  let timer: ReturnType<typeof setInterval> | undefined
  const stop = async () => {
    clearInterval(timer)
  }
  return {
    start(consume) {
      timer = setInterval(() => consume(new Uint8Array(640).fill(24)), 20)
    },
    stop,
    cancel: stop
  }
}
