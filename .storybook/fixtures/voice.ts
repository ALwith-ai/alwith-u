import type { AudioCapture, VoiceEvent } from "@alwith/module-voice"
import type { Channel } from "@tauri-apps/api/core"
export type VoiceCase =
  "disabled" | "idle" | "starting" | "recording" | "transcribing" | "error" | "unconfigured" | "noSpeech"
let mode: VoiceCase = "disabled"
let receiver: Channel<VoiceEvent> | null = null
let recordingId = ""
let nextSequence = 0
export function resetVoice(kind: VoiceCase = "disabled"): void {
  mode = kind
  receiver = null
  recordingId = ""
  nextSequence = 0
}
export function voiceRequest(command: string, args: Record<string, unknown>): unknown {
  if (command === "plugin:alwith-voice|profiles")
    return { vui: mode !== "unconfigured", doubao: mode !== "unconfigured" }
  if (command === "plugin:alwith-voice|start") {
    receiver = args.events as Channel<VoiceEvent>
    recordingId = (args.options as { recordingId: string }).recordingId
    nextSequence = 0
    if (mode === "starting") return new Promise(() => {})
    receiver.onmessage({ type: "ready", recordingId })
    return null
  }
  if (command === "plugin:alwith-voice|control") {
    if (args.recordingId !== recordingId) throw new Error(`Unknown recording: ${String(args.recordingId)}`)
    if (args.action === "finish") {
      if (mode === "transcribing") return null
      if (mode === "error")
        receiver!.onmessage({ type: "failed", recordingId, message: "模拟语音识别服务连接失败，请重试。" })
      else
        receiver!.onmessage({ type: "final", recordingId, text: mode === "noSpeech" ? "" : "请整理本周项目交付进度" })
    }
    if (args.action === "cancel") receiver!.onmessage({ type: "cancelled", recordingId })
    return null
  }
  if (command === "plugin:alwith-voice|delete_credential") return null
  throw new Error(`Unimplemented Storybook voice boundary: ${command}`)
}
/** One audio chunk of the current recording, in the order the transport numbers them. */
export function pushAudio(id: string, sequence: number, bytes: Uint8Array): null {
  if (id !== recordingId) throw new Error(`Audio for unknown recording: ${id}`)
  if (sequence !== nextSequence) throw new Error(`Audio chunk ${sequence} arrived, expected ${nextSequence}`)
  if (bytes.length === 0) throw new Error("An audio chunk carries no bytes")
  nextSequence++
  return null
}
// Synthetic capture replaces microphone hardware only; the shared voice interaction remains real.
export function prepareCapture(_options: unknown, signal: AbortSignal): Promise<AudioCapture> {
  signal.throwIfAborted()
  let timer: ReturnType<typeof setInterval> | undefined
  const stop = () => {
    clearInterval(timer)
    return Promise.resolve()
  }
  return Promise.resolve({
    start(consume) {
      timer = setInterval(() => consume(new Uint8Array(640).fill(24)), 20)
    },
    stop,
    cancel: stop
  })
}
