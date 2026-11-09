import type { ImageSelection } from "@alwith/module-chat/image"
import { motion, useReducedMotion } from "motion/react"
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { saveImageSelection, useImagePreferences, useImagePreferenceSync } from "@/features/images/preferences"
import { cn } from "@/lib/utils"

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
  if (!inputMode) return null
  return (
    <div data-input-mode-switch className="flex shrink-0 justify-center px-6 pt-6 pb-2">
      <InputModeToggle value={inputMode.mode} onChange={inputMode.setMode} />
    </div>
  )
}

/** The overlapping thumb and translation retain the ChatGPT home toggle's geometry. */
function InputModeToggle({ value, onChange }: { value: InputMode; onChange: (mode: InputMode) => void }) {
  const { t } = useTranslation()
  const reduceMotion = useReducedMotion()
  return (
    <div
      role="group"
      aria-label={t("chat.inputMode.label")}
      className="chat-mode-toggle relative isolate inline-grid h-9 w-54 max-w-full min-w-0 grid-cols-2 rounded-full select-none"
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
        event.preventDefault()
        const rtl = getComputedStyle(event.currentTarget).direction === "rtl"
        const first = event.key === "Home" || (rtl ? event.key === "ArrowRight" : event.key === "ArrowLeft")
        onChange(first ? "chat" : "image")
        event.currentTarget.querySelectorAll<HTMLButtonElement>("button")[first ? 0 : 1].focus()
      }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-px top-1/2 z-0 h-8.5 -translate-y-1/2 rounded-full bg-muted"
      />
      <motion.span
        aria-hidden="true"
        className="chat-mode-toggle-indicator pointer-events-none relative z-10 col-start-1 row-start-1 rounded-full border-border bg-background shadow-md"
        initial={false}
        animate={{ x: value === "chat" ? "0%" : "calc((100% - 17px) * var(--mode-toggle-direction))" }}
        transition={{ duration: reduceMotion ? 0 : 0.3, ease: [0.23, 1, 0.32, 1] }}
      />
      {(["chat", "image"] as const).map((mode) => (
        <Button
          key={mode}
          type="button"
          variant="ghost"
          aria-pressed={value === mode}
          className={cn(
            "relative z-10 row-start-1 h-full min-w-0 rounded-full text-sm font-medium hover:bg-transparent focus-visible:border-transparent focus-visible:ring-0 active:bg-transparent aria-pressed:bg-transparent dark:hover:bg-transparent dark:active:bg-transparent",
            mode === "chat" ? "col-start-1 ps-11 pe-9" : "col-start-2 ps-9 pe-11",
            value === mode ? "text-foreground" : "text-foreground/80 hover:text-foreground"
          )}
          onClick={() => {
            if (value !== mode) onChange(mode)
          }}
        >
          {t(`chat.inputMode.${mode}`)}
        </Button>
      ))}
    </div>
  )
}
