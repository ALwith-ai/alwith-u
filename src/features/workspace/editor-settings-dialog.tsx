import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import type { ReactNode } from "react"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SettingGroup, SettingRow } from "@/features/settings/sections/shared"
import { iconThemes, type IconTheme } from "./workspace-state"
import { saveEditorIconTheme, saveEditorSettings } from "./editor-settings"
import { useEditorPreferences } from "./use-editor-preferences"

export function EditorSettingsSection(): ReactNode {
  const { t } = useTranslation()
  const { settings, iconTheme } = useEditorPreferences()
  const save = (operation: () => void): void => {
    try {
      operation()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }
  return (
    <SettingGroup>
      <SettingRow title={t("workspace.fontSize")} aligned>
        <Input
          aria-label={t("workspace.fontSize")}
          type="number"
          min={8}
          max={40}
          value={settings.fontSize}
          onChange={event => {
            const value = event.target.valueAsNumber
            if (value >= 8 && value <= 40) save(() => saveEditorSettings({ ...settings, fontSize: value }))
          }}
        />
      </SettingRow>
      <SettingRow title={t("workspace.fontFamily")} aligned>
        <Input
          aria-label={t("workspace.fontFamily")}
          value={settings.fontFamily}
          maxLength={200}
          onChange={event => save(() => saveEditorSettings({ ...settings, fontFamily: event.target.value }))}
        />
      </SettingRow>
      {(["fontLigatures", "wordWrap", "minimap", "lineNumbers", "renderWhitespace"] as const).map(key => (
        <SettingRow key={key} title={t(`workspace.${key}`)}>
          <Switch
            aria-label={t(`workspace.${key}`)}
            checked={settings[key]}
            onCheckedChange={value => save(() => saveEditorSettings({ ...settings, [key]: value }))}
          />
        </SettingRow>
      ))}
      <SettingRow title={t("workspace.iconTheme")} aligned>
        <Select
          value={iconTheme ?? "vscode-icons"}
          onValueChange={value => {
            if (value === null || !iconThemes.includes(value as IconTheme)) throw new Error("Unknown file icon theme")
            save(() => saveEditorIconTheme(value as IconTheme))
          }}>
          <SelectTrigger className="w-full" aria-label={t("workspace.iconTheme")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {iconThemes.map(theme => (
              <SelectItem key={theme} value={theme}>
                {theme}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>
    </SettingGroup>
  )
}
