import { PromptInputButton } from "@alwith/module-chat/composer"
import { useCodexRealtimeVoice } from "@alwith/module-voice/react"
import { supportsCodexRealtime } from "@nyssance/codex-acp-v2/client"
import { HeadphonesIcon, Loader2Icon, PhoneOffIcon } from "lucide-react"
import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { client, useApp } from "@/lib/client"

import { useVoiceEnabled } from "./use-voice-enabled"

export function RealtimeVoiceButton({
  sessionId,
  enabled,
  beforeStart,
  onActive
}: {
  sessionId: string
  enabled: boolean
  beforeStart: () => void
  onActive: (active: boolean) => void
}) {
  const { t } = useTranslation()
  const voiceEnabled = useVoiceEnabled() === true
  const supported = useApp((state) => supportsCodexRealtime(state.agent))
  const voice = useCodexRealtimeVoice({
    sessionId,
    enabled: enabled && voiceEnabled && supported,
    client: () => client,
    onError: (error) => toast.error(error.message)
  })
  const { phase } = voice
  useEffect(() => {
    onActive(phase !== "idle")
  }, [phase, onActive])
  if (!voiceEnabled || !supported) return null
  const label = t(
    phase === "idle" ? "voice.realtimeStart" : phase === "connected" ? "voice.realtimeStop" : "voice.realtimeCancel"
  )
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <PromptInputButton
            type="button"
            aria-label={label}
            aria-pressed={phase === "connected"}
            disabled={phase === "closing" || (!enabled && phase === "idle")}
            onClick={() => {
              if (phase === "idle") beforeStart()
              void voice.toggle().catch((error) => toast.error(error instanceof Error ? error.message : String(error)))
            }}
          >
            {phase === "connecting" || phase === "closing" ? (
              <Loader2Icon className="animate-spin" />
            ) : phase === "connected" ? (
              <PhoneOffIcon />
            ) : (
              <HeadphonesIcon />
            )}
          </PromptInputButton>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
