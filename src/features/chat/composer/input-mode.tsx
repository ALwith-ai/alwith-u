import type { ImageSelection } from "@alwith/module-chat/image"
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { SegmentedControl } from "@/components/alwith-ui/segmented-control"
import { saveImageSelection, useImagePreferences, useImagePreferenceSync } from "@/features/images/preferences"

import type { ImageInputAspect } from "./image-tools"
import {
  type InputMode,
  readSessionImageSelection,
  readSessionInputMode,
  saveSessionImageSelection,
  saveSessionInputMode
} from "./input-mode-preferences"

const InputModeContext = createContext<{
  mode: InputMode
  draft: boolean
  setMode: (mode: InputMode) => void
  ready: boolean
  saveForSession: (sessionId: string) => Promise<void>
  aspect: ImageInputAspect
  setAspect: (aspect: ImageInputAspect) => void
  selection: ImageSelection
  setSelection: (selection: ImageSelection) => void
} | null>(null)

/** Main-window input preferences never classify or create conversations. */
export function MainInputModeProvider({
  children,
  sessionId = null,
  draft = true
}: {
  children: ReactNode
  sessionId?: string | null
  draft?: boolean
}) {
  const [draftMode, setDraftMode] = useState<InputMode>("chat")
  const [draftSelection, setDraftSelection] = useState<ImageSelection | null>(null)
  const [restored, setRestored] = useState<{ sessionId: string; mode: InputMode; selection?: ImageSelection } | null>(
    null
  )
  const revision = useRef(0)
  if (!draft && sessionId === null) throw new Error("An existing conversation must have a session id")
  const ready = draft || restored?.sessionId === sessionId
  const mode = draft ? draftMode : restored?.sessionId === sessionId ? restored.mode : "chat"
  useEffect(() => {
    if (draft || sessionId === null) return
    let active = true
    const read = () => {
      const started = revision.current
      void Promise.all([readSessionInputMode(sessionId), readSessionImageSelection(sessionId)]).then(
        ([mode, selection]) => {
          if (active && started === revision.current) setRestored({ sessionId, mode, selection })
        },
        (error: unknown) => {
          if (active) toast.error(error instanceof Error ? error.message : String(error))
        }
      )
    }
    read()
    window.addEventListener("focus", read)
    return () => {
      active = false
      window.removeEventListener("focus", read)
    }
  }, [draft, sessionId])
  const saveForSession = async (id: string) => {
    await saveSessionInputMode(id, mode, selection)
    setRestored({ sessionId: id, mode, selection })
  }
  const [aspect, setAspect] = useState<ImageInputAspect>("auto")
  useImagePreferenceSync()
  const recentSelection = useImagePreferences((state) => state.selection)
  const selection = draft
    ? (draftSelection ?? recentSelection)
    : restored?.sessionId === sessionId
      ? (restored.selection ?? recentSelection)
      : recentSelection
  const setSelection = (value: ImageSelection) => {
    ++revision.current
    if (draft) setDraftSelection(value)
    else if (sessionId !== null) {
      setRestored({ sessionId, mode, selection: value })
      void saveSessionImageSelection(sessionId, value).catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : String(error))
      )
    }
    void saveImageSelection(value).catch((error: unknown) =>
      toast.error(error instanceof Error ? error.message : String(error))
    )
  }
  return (
    <InputModeContext
      value={{ mode, draft, setMode: setDraftMode, ready, saveForSession, aspect, setAspect, selection, setSelection }}
    >
      {children}
    </InputModeContext>
  )
}

export function useInputMode() {
  return useContext(InputModeContext)
}

/** Mode selection belongs to the top of the main conversation content. */
export function MainInputModeSwitch() {
  const inputMode = useInputMode()
  const { t } = useTranslation()
  if (!inputMode) return null
  return (
    <div data-input-mode-switch className="flex shrink-0 justify-center px-6 pt-6 pb-2">
      <SegmentedControl
        aria-label={t("chat.inputMode.label")}
        items={[
          { value: "chat", label: t("chat.inputMode.chat") },
          { value: "image", label: t("chat.inputMode.image") }
        ]}
        value={inputMode.mode}
        onValueChange={inputMode.setMode}
      />
    </div>
  )
}
