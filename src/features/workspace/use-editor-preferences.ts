import { useEffect, useState } from "react"
import { toast } from "sonner"
import {
  defaultEditorSettings,
  loadEditorIconTheme,
  loadEditorSettings,
  subscribeEditorSettings,
  type EditorSettings
} from "./editor-settings"
import type { IconTheme } from "./workspace-state"

interface EditorPreferences {
  settings: EditorSettings
  iconTheme: IconTheme | null
}

function readPreferences(): EditorPreferences {
  let settings = defaultEditorSettings
  let iconTheme: IconTheme | null = null
  try {
    settings = loadEditorSettings()
    iconTheme = loadEditorIconTheme()
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error))
  }
  return { settings, iconTheme }
}

export function useEditorPreferences(): EditorPreferences {
  const [preferences, setPreferences] = useState(readPreferences)
  useEffect(() => {
    const refresh = (): void => setPreferences(readPreferences())
    const stop = subscribeEditorSettings(refresh)
    refresh()
    return stop
  }, [])
  return preferences
}
