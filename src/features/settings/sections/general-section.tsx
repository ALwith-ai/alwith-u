import { getVersion } from "@tauri-apps/api/app"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { useStore } from "zustand"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { predictionPreference, setPredictionsEnabled } from "@/features/chat/composer/prediction-preference"
import { ProjectAppIcon, useExternalApps } from "@/features/chat/open-in-editor"
import { requestChatSurface } from "@/lib/chat-window"
import i18n, { isLanguageCode, LANGUAGES } from "@/lib/i18n"
import { loadPreferences, savePreference } from "@/lib/preferences"

import { AutostartRow } from "./autostart-row"
import { SettingGroup, SettingRow } from "./shared"
import { TrackpadRow } from "./trackpad-row"

export function GeneralSection() {
  const { t } = useTranslation()
  const predictions = useStore(predictionPreference, (state) => state.enabled)
  const [savingPredictions, setSavingPredictions] = useState(false)
  const [version, setVersion] = useState("")
  useEffect(() => {
    void getVersion().then(setVersion)
  }, [])
  const apps = useExternalApps()
  const [externalEditor, setExternalEditor] = useState<string | null>(null)
  const [shortcut, setShortcut] = useState("")
  const [savingShortcut, setSavingShortcut] = useState(false)
  useEffect(() => {
    void loadPreferences().then((preferences) => {
      setExternalEditor(preferences.externalEditor)
      setShortcut(preferences.chatWindowShortcut ?? "Alt+Space")
    })
  }, [])
  const activeEditor = apps.find((app) => app.bundle_id === externalEditor) ?? apps[0]
  return (
    <SettingGroup>
      <SettingRow title={t("settings.versionLabel")} aligned>
        <span className="block text-end text-sm text-muted-foreground">v{version}</span>
      </SettingRow>
      <Separator />
      <SettingRow title={t("chatWindow.shortcut")} aligned>
        <div className="flex w-full items-center gap-2">
          <Input
            className="min-w-0 flex-1"
            aria-label={t("chatWindow.shortcut")}
            value={shortcut}
            placeholder={t("chatWindow.shortcutOff")}
            onChange={(event) => setShortcut(event.target.value)}
            disabled={savingShortcut}
          />
          <Button
            variant="outline"
            size="default"
            disabled={savingShortcut}
            onClick={() => {
              setSavingShortcut(true)
              void requestChatSurface("main", { type: "shortcut", shortcut: shortcut.trim() })
                .catch((error: unknown) => toast.error(error instanceof Error ? error.message : String(error)))
                .finally(() => setSavingShortcut(false))
            }}
          >
            {t("chatWindow.shortcutSave")}
          </Button>
        </div>
      </SettingRow>
      <Separator />
      <SettingRow title={t("settings.language")} aligned>
        <Select
          value={i18n.language}
          onValueChange={(value) => {
            if (!value || !isLanguageCode(value)) return
            void i18n.changeLanguage(value)
            void savePreference("language", value)
          }}
        >
          <SelectTrigger id="language" className="w-full" aria-label={t("settings.language")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {LANGUAGES.map((language) => (
                <SelectItem key={language.code} value={language.code}>
                  {language.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </SettingRow>
      {apps.length > 0 && (
        <>
          <Separator />
          <SettingRow title={t("settings.externalEditor")} desc={t("settings.externalEditorDesc")} aligned>
            <Select
              value={activeEditor?.bundle_id ?? ""}
              onValueChange={(value) => {
                if (!value) return
                setExternalEditor(value)
                void savePreference("externalEditor", value)
              }}
            >
              <SelectTrigger id="external-editor" className="w-full" aria-label={t("settings.externalEditor")}>
                <SelectValue>
                  <ProjectAppIcon app={activeEditor} />
                  {activeEditor?.name}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {apps.map((app) => (
                    <SelectItem key={app.bundle_id} value={app.bundle_id}>
                      <span className="flex items-center gap-2">
                        <ProjectAppIcon app={app} />
                        {app.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </SettingRow>
        </>
      )}
      <Separator />
      <SettingRow title={t("settings.composerPredictions")} desc={t("settings.composerPredictionsDesc")} aligned>
        <div className="flex justify-end">
          <Switch
            aria-label={t("settings.composerPredictions")}
            checked={predictions}
            disabled={savingPredictions}
            onCheckedChange={(enabled) => {
              setSavingPredictions(true)
              void setPredictionsEnabled(enabled)
                .catch((error: unknown) => toast.error(String(error)))
                .finally(() => setSavingPredictions(false))
            }}
          />
        </div>
      </SettingRow>
      <Separator />
      <TrackpadRow />
      <Separator />
      <AutostartRow />
    </SettingGroup>
  )
}
