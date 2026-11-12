import type * as acp from "@agentclientprotocol/sdk/experimental/v2/unstable"
import { isSelectOption, type PromptOptions } from "@alwith/module-chat/client"
/**
 * U's composer: the package composer with U's dictation and realtime voice, native file drops,
 * model catalog and prediction preference.
 */
import { Composer, type ComposerProps, useComposer } from "@alwith/module-chat/conversation"
import { useCallback, useLayoutEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useStore } from "zustand"

import { isAuthenticationRequired } from "@/core/request-error"
import { observeVoiceTurn } from "@/core/voice-turn"
import { useImageAvailability } from "@/features/images/availability"
import { RealtimeVoiceButton } from "@/features/voice/realtime-voice-button"
import type { VoiceResume } from "@/features/voice/use-voice-handoff"
import { VoiceButton } from "@/features/voice/voice-button"
import { useWorkspace } from "@/features/workspace/context"
import { client } from "@/lib/client"

import { AccountModelRecovery } from "./composer/account-model-recovery"
import { AuthenticationRecovery } from "./composer/authentication-recovery"
import { ImageModelSelect } from "./composer/image-model-select"
import { ImageInputTools } from "./composer/image-tools"
import { useInputMode } from "./composer/input-mode"
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

export type ChatSubmit = (
  prompt: acp.ContentBlock[],
  accept?: (receipt: string) => void,
  options?: PromptOptions
) => Promise<void>

export function ChatComposer({
  voiceResume,
  ...props
}: Omit<ComposerProps, "actions" | "children" | "attachmentPolicy" | "predictions" | "onSubmit"> & {
  voiceResume?: VoiceResume
  onSubmit?: ChatSubmit
}) {
  const { t } = useTranslation()
  const inputMode = useInputMode()
  const imageMode = inputMode?.mode === "image"
  const availability = useImageAvailability(imageMode, inputMode?.selection)
  const predictions = useStore(predictionPreference, (state) => state.enabled)
  const predictionUnavailable = props.session.configOptions.some(
    (option) =>
      isSelectOption(option) &&
      (((option.category === "model" || option.configId === "model") && option.currentValue.startsWith("gateway:")) ||
        (option.configId === "collaboration_mode" && option.currentValue === "plan"))
  )
  const accountRecovery = useStore(client.store, (state) => state.accountModelRecovery?.[props.session.id] ?? false)
  const submit: ComposerProps["onSubmit"] = imageMode
    ? async (prompt, accept) => {
        if (!availability.canGenerate) throw new Error(t("images.connectServices"))
        const options: PromptOptions = {
          meta: {
            alwith: {
              imageIntent: "generate",
              imageSelection: { ...inputMode.selection },
              imageAspectRatio: inputMode.aspect
            }
          }
        }
        if (props.onSubmit) await props.onSubmit(prompt, accept, options)
        else {
          const receipt = await client.prompt(props.session.id, prompt, options)
          accept?.(receipt)
        }
      }
    : props.onSubmit
  if (!props.session.attached && isAuthenticationRequired(props.session.error?.error))
    return <AuthenticationRecovery session={props.session} />
  return (
    <>
      {accountRecovery && <AccountModelRecovery key={props.session.id} session={props.session} />}
      <Composer
        modelMenu={chatModelMenu}
        {...props}
        disabled={props.disabled || inputMode?.ready === false || (imageMode && !availability.canGenerate)}
        allowPendingInput={imageMode || props.allowPendingInput}
        agentControls={imageMode ? false : props.agentControls}
        onSubmit={submit}
        placeholder={imageMode ? t("chat.inputMode.placeholder") : props.placeholder}
        leadingTools={
          imageMode ? (
            <ImageInputTools
              value={inputMode.aspect}
              onChange={inputMode.setAspect}
              disabled={Boolean(props.disabled || props.preparing || props.session.readOnly)}
            />
          ) : (
            props.leadingTools
          )
        }
        modelSelector={
          imageMode ? (
            <ImageModelSelect
              selection={inputMode.selection}
              onChange={inputMode.setSelection}
              disabled={!inputMode.draft || Boolean(props.disabled || props.preparing || props.session.readOnly)}
            />
          ) : (
            props.modelSelector
          )
        }
        predictions={!imageMode && predictions && !predictionUnavailable}
        attachmentPolicy={nativeAttachmentPolicy}
        onShellCommand={imageMode ? undefined : (command) => client.executeShell(props.session.id, command)}
        actions={imageMode ? undefined : <ComposerVoice voiceResume={voiceResume} />}
      >
        <ComposerFileDrop />
      </Composer>
    </>
  )
}
