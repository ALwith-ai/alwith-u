import { isSelectOption } from "@alwith/module-chat/client"
/**
 * U's composer: the package composer with U's dictation and realtime voice, native file drops,
 * model catalog and prediction preference.
 */
import { Composer, type ComposerProps, useComposer } from "@alwith/module-chat/conversation"
import { useCallback, useLayoutEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useStore } from "zustand"

import type { ImageRequestAspect } from "@/agent/image-request"
import { isImageSession } from "@/agent/session-kind"
import { observeVoiceTurn } from "@/core/voice-turn"
import { ImageAspectSelect } from "@/features/images/aspect-select"
import { useImageAvailability } from "@/features/images/availability"
import { ImageModelSelect } from "@/features/images/model-select"
import { ImageServiceNotice } from "@/features/images/service-notice"
import { RealtimeVoiceButton } from "@/features/voice/realtime-voice-button"
import type { VoiceResume } from "@/features/voice/use-voice-handoff"
import { VoiceButton } from "@/features/voice/voice-button"
import { useWorkspace } from "@/features/workspace/context"
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
        enabled={composer.ready && !realtimeActive && !composer.shellMode}
        cancelRef={composer.interruptRef}
        waitForTurn={waitForTurn}
        supportsHandsfree={composer.handsFree}
        resume={resume}
      />
      <RealtimeVoiceButton
        key={session.id}
        sessionId={session.id}
        enabled={composer.ready && !composer.shellMode}
        beforeStart={() => composer.interruptRef.current?.()}
        onActive={setRealtimeActive}
      />
    </>
  )
}

function ComposerFileDrop() {
  const composer = useComposer()
  const register = useWorkspace()?.registerFileReference
  const { t } = useTranslation()
  const sessionId = composer.session.id
  const { inputReady, sending, shellMode, addMention, textareaRef } = composer
  useLayoutEffect(
    () =>
      register?.({
        sessionId,
        add: (path) => {
          if (!inputReady || sending || shellMode) throw new Error(t("chat.input.dropUnavailable"))
          addMention(path)
          textareaRef.current?.focus()
        }
      }),
    [register, sessionId, inputReady, sending, shellMode, addMention, textareaRef, t]
  )
  return (
    <NativeFileDrop
      sessionId={composer.session.id}
      enabled={composer.inputReady && !composer.sending && !composer.shellMode}
      onMention={composer.addMention}
      onBusyChange={composer.setAdding}
    />
  )
}

export function ChatComposer({
  voiceResume,
  ...props
}: Omit<ComposerProps, "actions" | "children" | "attachmentPolicy" | "predictions"> & { voiceResume?: VoiceResume }) {
  const { t } = useTranslation()
  const [aspect, setAspect] = useState<ImageRequestAspect>("auto")
  const predictions = useStore(predictionPreference, (state) => state.enabled)
  const predictionUnavailable = props.session.configOptions.some(
    (option) =>
      isSelectOption(option) &&
      (((option.category === "model" || option.configId === "model") && option.currentValue.startsWith("gateway:")) ||
        (option.configId === "collaboration_mode" && option.currentValue === "plan"))
  )
  const accountRecovery = useStore(client.store, (state) => state.accountModelRecovery?.[props.session.id] ?? false)
  const imageConversation = useStore(client.store, (state) =>
    [...state.sessionList, ...state.archivedSessions].some(
      (row) => row.sessionId === props.session.id && isImageSession(row)
    )
  )
  const imageAvailability = useImageAvailability(imageConversation)
  return (
    <>
      {accountRecovery && <AccountModelRecovery key={props.session.id} session={props.session} />}
      {imageConversation && <ImageServiceNotice availability={imageAvailability} />}
      <Composer
        modelMenu={chatModelMenu}
        {...props}
        disabled={props.disabled || (imageConversation && !imageAvailability.canGenerate)}
        allowPendingInput={props.allowPendingInput || imageConversation}
        agentControls={!imageConversation}
        placeholder={imageConversation ? t("images.prompt") : undefined}
        leadingTools={
          imageConversation ? (
            <ImageAspectSelect value={aspect} onChange={setAspect} disabled={props.disabled ?? false} />
          ) : undefined
        }
        onSubmit={
          imageConversation
            ? async (prompt, accept) => {
                if (!imageAvailability.canGenerate) throw new Error(t("images.connectServices"))
                const receipt = await client.promptWithImages(props.session.id, prompt, {
                  meta: { alwith: { imageAspectRatio: aspect } }
                })
                accept?.(receipt)
              }
            : props.onSubmit
        }
        modelSelector={imageConversation ? <ImageModelSelect /> : props.modelSelector}
        predictions={!imageConversation && predictions && !predictionUnavailable}
        attachmentPolicy={nativeAttachmentPolicy}
        onShellCommand={imageConversation ? undefined : (command) => client.executeShell(props.session.id, command)}
        actions={imageConversation ? undefined : <ComposerVoice voiceResume={voiceResume} />}
      >
        {!imageConversation && <ComposerFileDrop />}
      </Composer>
    </>
  )
}
