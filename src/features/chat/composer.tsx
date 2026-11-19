import type * as acp from "@agentclientprotocol/sdk/experimental/v2/unstable"
import { isSelectOption, type PromptOptions } from "@alwith/module-chat/client"
/**
 * U's composer: the shared desktop composer with U's dictation and realtime voice, image input,
 * workspace file references, enterprise model marks and prediction preference.
 */
import { type ComposerProps, useComposer } from "@alwith/module-chat/conversation"
import { DesktopComposer } from "@alwith/module-chat/desktop"
import { open as openFileDialog } from "@tauri-apps/plugin-dialog"
import { useCallback, useLayoutEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useStore } from "zustand"

import { observeVoiceTurn } from "@/core/voice-turn"
import { useImageAvailability } from "@/features/images/availability"
import { RealtimeVoiceButton } from "@/features/voice/realtime-voice-button"
import type { VoiceResume } from "@/features/voice/use-voice-handoff"
import { VoiceButton } from "@/features/voice/voice-button"
import { useWorkspace } from "@/features/workspace/context"
import { client } from "@/lib/client"
import { providersPort } from "@/lib/providers"

import { ImageModelSelect } from "./composer/image-model-select"
import { ImageInputTools } from "./composer/image-tools"
import { useInputMode } from "./composer/input-mode"
import { chatCatalog } from "./composer/model-catalog"
import { predictionPreference } from "./composer/prediction-preference"

async function pickChatFilePaths(): Promise<string[]> {
  return (await openFileDialog({ multiple: true })) ?? []
}

const desktopAttachmentPicker = { pickFilePaths: pickChatFilePaths }

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

/** Files the workspace sends to the chat become mentions, as dropped files do. */
function WorkspaceFileReferences() {
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
  return null
}

export type ChatSubmit = (
  prompt: acp.ContentBlock[],
  accept?: (receipt: string) => void,
  options?: PromptOptions
) => Promise<void>

export function ChatComposer({
  voiceResume,
  inputDisabled = false,
  ...props
}: Omit<ComposerProps, "actions" | "children" | "attachmentPolicy" | "onShellCommand" | "predictions" | "onSubmit"> & {
  voiceResume?: VoiceResume
  /** Draft changes protect input without disabling the window or pending request dialogs. */
  inputDisabled?: boolean
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
  return (
    <DesktopComposer
      client={client}
      providers={providersPort}
      catalog={chatCatalog}
      shellCommands={!imageMode}
      imagesOnly={imageMode}
      allowDirectory
      {...desktopAttachmentPicker}
      {...props}
      disabled={
        inputDisabled || props.disabled || inputMode?.ready === false || (imageMode && !availability.canGenerate)
      }
      allowPendingInput={!inputDisabled && (imageMode || props.allowPendingInput)}
      agentControls={imageMode ? false : props.agentControls}
      onSubmit={submit}
      placeholder={imageMode ? t("chat.inputMode.placeholder") : props.placeholder}
      leadingTools={
        imageMode ? (
          <ImageInputTools
            value={inputMode.aspect}
            onChange={inputMode.setAspect}
            disabled={Boolean(inputDisabled || props.disabled || props.preparing || props.session.readOnly)}
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
            disabled={
              !inputMode.draft || Boolean(inputDisabled || props.disabled || props.preparing || props.session.readOnly)
            }
          />
        ) : (
          props.modelSelector
        )
      }
      predictions={!imageMode && predictions && !predictionUnavailable}
      actions={<ComposerVoice voiceResume={voiceResume} />}
    >
      <WorkspaceFileReferences />
    </DesktopComposer>
  )
}
