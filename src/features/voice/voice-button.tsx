import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import "./voice-waveform.css"
import { usePromptInputSubmission } from "@alwith/module-chat/composer-context"
import { recordingSettings } from "@alwith/module-voice"
import { prepareCapture } from "@alwith/module-voice/audio"
import type { DraftPort } from "@alwith/module-voice/chat"
import { useVoiceInteraction } from "@alwith/module-voice/react"
import { createTauriTransport } from "@alwith/module-voice/tauri"
import workletUrl from "@alwith/module-voice/worklet?url"
import { Channel, invoke } from "@tauri-apps/api/core"
import { Loader2Icon, MicIcon, SquareIcon, XIcon } from "lucide-react"
import { type MutableRefObject, type ReactNode, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { PromptInputButton } from "@alwith/module-chat/composer"
import { openSettingsWindow } from "@/lib/window-manager"

import { loadVoiceSettings, voiceProfiles } from "./settings"
import { useVoiceEnabled } from "./use-voice-enabled"
import { VoiceWaveform } from "./voice-waveform"

const transport = createTauriTransport({ invoke, channel: (receive) => new Channel(receive) })
interface VoiceButtonProps {
  draft: DraftPort
  cwd: string
  enabled: boolean
  cancelRef: MutableRefObject<(() => void) | null>
  waitForTurn: (signal: AbortSignal) => Promise<void>
  supportsHandsfree: boolean
  resume?: (signal: AbortSignal) => Promise<void>
}

export function VoiceButton(props: VoiceButtonProps): ReactNode {
  return useVoiceEnabled() === true ? <EnabledVoiceButton key={props.draft.read().target} {...props} /> : null
}

function EnabledVoiceButton({
  draft,
  cwd,
  enabled,
  cancelRef,
  waitForTurn,
  supportsHandsfree,
  resume
}: VoiceButtonProps): ReactNode {
  const { t } = useTranslation()
  const submit = usePromptInputSubmission()
  const interactionCancel = useRef<(() => void) | null>(null)
  const resumeAbort = useRef<AbortController | null>(null)
  const startPending = useRef(false)
  const initialResume = useRef(resume)
  const [resuming, setResuming] = useState(resume !== undefined)
  const report = (error: Error): void => {
    const detail = "detail" in error ? error.detail : null
    const reference =
      typeof detail === "object" && detail !== null && "requestId" in detail && typeof detail.requestId === "string"
        ? ` (${detail.requestId})`
        : ""
    const message = error.message === "voice_existing_draft" ? t("voice.existingDraft") : error.message
    toast.error(message + reference)
  }
  const reportRef = useRef(report)
  reportRef.current = report
  const interaction = useVoiceInteraction({
    optionTap: true,
    transport,
    enabled: enabled && !resuming,
    cancelRef: interactionCancel,
    capture: (settings, signal) => prepareCapture({ deviceId: settings.deviceId, workletUrl }, signal),
    host: {
      draft,
      canStart: () => enabled,
      supportsHandsfree: () => supportsHandsfree,
      loadSettings: async () => recordingSettings(await loadVoiceSettings(), cwd),
      isConfigured: async (provider) => (await voiceProfiles())[provider],
      configure: () => openSettingsWindow("voice"),
      submit: async () => {
        if (submit === null) throw new Error("voice_submit_unavailable")
        return submit()
      },
      waitForTurn,
      onNoSpeech: () => toast.info(t("voice.noSpeech")),
      onError: report
    }
  })
  const startRef = useRef(interaction.start)
  startRef.current = interaction.start
  useEffect(() => {
    cancelRef.current = () => {
      startPending.current = false
      resumeAbort.current?.abort()
      setResuming(false)
      interactionCancel.current?.()
    }
    return () => {
      cancelRef.current = null
    }
  }, [cancelRef])
  useEffect(() => {
    if (!enabled || !resuming) return
    // The shared interaction is disabled during handoff; retain its clean single-tap cancellation.
    let pressedAt: number | null = null
    const reset = (): void => {
      pressedAt = null
    }
    const blocked = (event: KeyboardEvent): boolean =>
      event.key !== "Alt" ||
      event.repeat ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.isComposing ||
      event.defaultPrevented ||
      document.visibilityState === "hidden"
    const down = (event: KeyboardEvent): void => {
      if (blocked(event) || pressedAt !== null) reset()
      else pressedAt = performance.now()
    }
    const up = (event: KeyboardEvent): void => {
      const started = pressedAt
      reset()
      if (blocked(event) || started === null || performance.now() - started > 500) return
      event.preventDefault()
      cancelRef.current?.()
    }
    window.addEventListener("keydown", down)
    window.addEventListener("keyup", up)
    window.addEventListener("blur", reset)
    window.addEventListener("pointerdown", reset)
    document.addEventListener("visibilitychange", reset)
    return () => {
      window.removeEventListener("keydown", down)
      window.removeEventListener("keyup", up)
      window.removeEventListener("blur", reset)
      window.removeEventListener("pointerdown", reset)
      document.removeEventListener("visibilitychange", reset)
    }
  }, [enabled, resuming, cancelRef])
  useEffect(() => {
    const pending = initialResume.current
    if (!enabled) {
      startPending.current = false
      initialResume.current = undefined
      setResuming(false)
      return
    }
    if (pending === undefined) return
    initialResume.current = undefined
    const abort = new AbortController()
    let settled = false
    resumeAbort.current = abort
    void (async () => {
      try {
        await pending(abort.signal)
        abort.signal.throwIfAborted()
        if ((await loadVoiceSettings()).mode !== "handsfree") return
        abort.signal.throwIfAborted()
        startPending.current = true
      } catch (error) {
        if (!abort.signal.aborted) reportRef.current(error instanceof Error ? error : new Error(String(error)))
      } finally {
        settled = true
        if (!abort.signal.aborted) setResuming(false)
      }
    })()
    return () => {
      // StrictMode replays setup; keep an unfinished handoff available for that next setup.
      if (!settled && !abort.signal.aborted) initialResume.current = pending
      abort.abort()
      resumeAbort.current = null
    }
  }, [enabled, draft])
  // Start after the hook has received enabled=true, rather than from a stale render during the handoff.
  useEffect(() => {
    if (resuming || !startPending.current) return
    startPending.current = false
    void startRef
      .current()
      .catch((error: unknown) => reportRef.current(error instanceof Error ? error : new Error(String(error))))
  }, [resuming])
  const { state, audioLevel, toggle, cancel } = interaction
  const phase = state.phase
  const busy = resuming || state.waiting
  const label = t(
    phase === "starting"
      ? "voice.starting"
      : phase === "finishing"
        ? "voice.finishing"
        : phase === "recording"
          ? "voice.stop"
          : "voice.start"
  )
  return (
    <div className="voice-controls-layout">
      <Tooltip>
        <TooltipTrigger
          render={
            <PromptInputButton
              aria-label={label}
              className={phase === "recording" ? "voice-recording-button" : undefined}
              disabled={!enabled || busy || phase === "finishing"}
              onClick={() => {
                void toggle().catch(report)
              }}
            >
              {phase === "starting" || phase === "finishing" ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : phase === "recording" ? (
                <>
                  <VoiceWaveform audioLevel={audioLevel} />
                  <SquareIcon className="size-2.5 shrink-0 fill-current text-foreground" aria-hidden="true" />
                </>
              ) : (
                <MicIcon className="size-4" />
              )}
            </PromptInputButton>
          }
        />
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      {(busy || phase === "starting" || phase === "recording" || phase === "finishing") && (
        <PromptInputButton
          aria-label={t("voice.cancel")}
          title={t("voice.cancel")}
          onClick={() => {
            startPending.current = false
            resumeAbort.current?.abort()
            setResuming(false)
            cancel(true)
          }}
        >
          <XIcon className="size-4 text-foreground" />
        </PromptInputButton>
      )}
    </div>
  )
}
