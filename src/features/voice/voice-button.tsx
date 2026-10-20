import "./voice-waveform.css"
import { usePromptInputSubmission } from "@alwith/module-chat/composer-context"
import { recordingSettings } from "@alwith/module-voice"
import { prepareCapture } from "@alwith/module-voice/audio"
import type { DraftPort } from "@alwith/module-voice/chat"
import { VoiceControls } from "@alwith/module-voice/react"
import { createTauriTransport } from "@alwith/module-voice/tauri"
import workletUrl from "@alwith/module-voice/worklet?url"
import { Channel, invoke } from "@tauri-apps/api/core"
import { Loader2Icon, MicIcon, SquareIcon, XIcon } from "lucide-react"
import type { MutableRefObject, ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { PromptInputButton } from "@/features/chat/composer/prompt-input"
import { openSettingsWindow } from "@/lib/window-manager"

import { loadVoiceSettings, voiceProfiles } from "./settings"
import { useVoiceEnabled } from "./use-voice-enabled"
import { VoiceWaveform } from "./voice-waveform"
const transport = createTauriTransport({ invoke, channel: (receive) => new Channel(receive) })
export function VoiceButton({
  draft,
  cwd,
  enabled,
  cancelRef,
  waitForTurn,
  supportsHandsfree
}: {
  draft: DraftPort
  cwd: string
  enabled: boolean
  cancelRef: MutableRefObject<(() => void) | null>
  waitForTurn(signal: AbortSignal): Promise<void>
  supportsHandsfree: boolean
}): ReactNode {
  const { t } = useTranslation()
  const submit = usePromptInputSubmission()
  const voiceEnabled = useVoiceEnabled()
  if (voiceEnabled !== true) return null
  return (
    <VoiceControls
      optionTap
      shortcutHint={t("voice.shortcutHint")}
      transport={transport}
      enabled={enabled}
      cancelRef={cancelRef}
      Button={PromptInputButton}
      capture={(settings, signal) => prepareCapture({ deviceId: settings.deviceId, workletUrl }, signal)}
      labels={{
        start: t("voice.start"),
        stop: t("voice.stop"),
        cancel: t("voice.cancel"),
        starting: t("voice.starting"),
        finishing: t("voice.finishing")
      }}
      icons={{
        start: <MicIcon className="size-4" />,
        stop: <SquareIcon className="size-3 fill-current text-foreground" />,
        cancel: <XIcon className="size-4 text-foreground" />,
        busy: <Loader2Icon className="size-4 animate-spin" />
      }}
      renderLayout={({ controls, state, audioLevel }) => (
        <div className="voice-controls-layout">
          <div className="voice-controls-buttons">{controls}</div>
          <div className="voice-waveform-track" aria-hidden="true">
            {state.phase === "recording" && <VoiceWaveform audioLevel={audioLevel} />}
          </div>
        </div>
      )}
      host={{
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
        onError: (error) => {
          const detail = "detail" in error ? error.detail : null
          const reference =
            typeof detail === "object" &&
            detail !== null &&
            "requestId" in detail &&
            typeof detail.requestId === "string"
              ? ` (${detail.requestId})`
              : ""
          toast.error(error.message + reference)
        }
      }}
    />
  )
}
