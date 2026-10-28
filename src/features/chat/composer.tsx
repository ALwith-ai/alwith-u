/**
 * U's composer: the package composer with U's dictation and realtime voice, native file drops,
 * model catalog and prediction preference.
 */
import { Composer, type ComposerProps, useComposer } from "@alwith/module-chat/conversation"
import { useCallback, useState } from "react"
import { useStore } from "zustand"

import { observeVoiceTurn } from "@/core/voice-turn"
import { RealtimeVoiceButton } from "@/features/voice/realtime-voice-button"
import type { VoiceResume } from "@/features/voice/use-voice-handoff"
import { VoiceButton } from "@/features/voice/voice-button"
import { client } from "@/lib/client"

import { AccountModelRecovery } from "./composer/account-model-recovery"
import { chatModelMenu } from "./composer/model-catalog"
import { nativeAttachmentPolicy, NativeFileDrop } from "./composer/native-file-drop"
import { predictionPreference } from "./composer/prediction-preference"

function ComposerVoice({ voiceResume }: { voiceResume?: VoiceResume }) {
  const composer = useComposer()
  const { observeReceipts, session } = composer
  const [realtimeActive, setRealtimeActive] = useState(false)
  const observe = useCallback(
    (signal: AbortSignal) => {
      const observation = observeVoiceTurn(
        {
          read: () => client.store.getState().sessions[session.id],
          subscribe: (check) => client.store.subscribe(check)
        },
        signal
      )
      const release = observeReceipts({ accept: observation.accept, signal })
      void observation.completed.then(release, release)
      return observation
    },
    [observeReceipts, session.id]
  )
  const waitForTurn = useCallback((signal: AbortSignal) => observe(signal).completed, [observe])
  const resume =
    voiceResume === undefined
      ? undefined
      : (signal: AbortSignal): Promise<void> => {
          const observation = observe(signal)
          observation.accept(voiceResume.receipt)
          voiceResume.consume()
          return observation.completed
        }
  return (
    <>
      <VoiceButton
        draft={composer.draft}
        cwd={session.cwd}
        enabled={composer.ready && !realtimeActive}
        cancelRef={composer.interruptRef}
        waitForTurn={waitForTurn}
        supportsHandsfree={composer.handsFree}
        resume={resume}
      />
      <RealtimeVoiceButton
        key={session.id}
        sessionId={session.id}
        enabled={composer.ready}
        beforeStart={() => composer.interruptRef.current?.()}
        onActive={setRealtimeActive}
      />
    </>
  )
}

function ComposerFileDrop() {
  const composer = useComposer()
  return (
    <NativeFileDrop
      sessionId={composer.session.id}
      enabled={composer.inputReady && !composer.sending}
      onMention={composer.addMention}
      onBusyChange={composer.setAdding}
    />
  )
}

export function ChatComposer({
  voiceResume,
  ...props
}: Omit<ComposerProps, "actions" | "children" | "attachmentPolicy" | "predictions"> & { voiceResume?: VoiceResume }) {
  const predictions = useStore(predictionPreference, (state) => state.enabled)
  const accountRecovery = useStore(client.store, (state) => state.accountModelRecovery?.[props.session.id] ?? false)
  return (
    <>
      {accountRecovery && <AccountModelRecovery key={props.session.id} session={props.session} />}
      <Composer
        modelMenu={chatModelMenu}
        {...props}
        predictions={predictions}
        attachmentPolicy={nativeAttachmentPolicy}
        actions={<ComposerVoice voiceResume={voiceResume} />}
      >
        <ComposerFileDrop />
      </Composer>
    </>
  )
}
