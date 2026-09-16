import { getVersion } from "@tauri-apps/api/app"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { useExternalApps } from "@/features/chat/open-in-editor"
import i18n, { LANGUAGES, isLanguageCode } from "@/lib/i18n"
import { loadPreferences, savePreference } from "@/lib/preferences"
import { SettingGroup, SettingRow } from "./shared"

export function GeneralSection() {
  const { t } = useTranslation()
  const [version, setVersion] = useState("")
  useEffect(() => {
    void getVersion().then(setVersion)
  }, [])
  const apps = useExternalApps()
  const [externalEditor, setExternalEditor] = useState<string | null>(null)
  useEffect(() => {
    void loadPreferences().then(preferences => setExternalEditor(preferences.externalEditor))
  }, [])
  const activeEditor = apps.find(app => app.bundle_id === externalEditor) ?? apps[0]
  return (
    <SettingGroup>
      <SettingRow title={t("settings.versionLabel")}>
        <span className="text-muted-foreground text-sm">v{version}</span>
      </SettingRow>
      <Separator />
      <SettingRow title={t("settings.language")}>
        <Select
          value={i18n.language}
          onValueChange={value => {
            if (!value || !isLanguageCode(value)) return
            void i18n.changeLanguage(value)
            void savePreference("language", value)
          }}>
          <SelectTrigger id="language" className="w-48" aria-label={t("settings.language")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {LANGUAGES.map(language => (
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
          <SettingRow title={t("settings.externalEditor")} desc={t("settings.externalEditorDesc")}>
            <Select
              value={activeEditor?.bundle_id ?? ""}
              onValueChange={value => {
                if (!value) return
                setExternalEditor(value)
                void savePreference("externalEditor", value)
              }}>
              <SelectTrigger id="external-editor" className="w-48" aria-label={t("settings.externalEditor")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {apps.map(app => (
                    <SelectItem key={app.bundle_id} value={app.bundle_id}>
                      {app.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </SettingRow>
        </>
      )}
    </SettingGroup>
  )
}
