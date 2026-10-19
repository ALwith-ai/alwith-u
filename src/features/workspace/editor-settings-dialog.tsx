import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { SettingGroup, SettingRow } from "@/features/settings/sections/shared"
import { saveEditorIconTheme, saveEditorSettings } from "./editor-settings"
import { useEditorPreferences } from "./use-editor-preferences"
import { type IconTheme, iconThemes } from "./workspace-state"

export function EditorSettingsSection(): ReactNode {
  const { t } = useTranslation()
  const { settings, iconTheme } = useEditorPreferences()
  const save = (operation: () => Promise<void>): void => {
    void operation().catch((error: unknown) => toast.error(error instanceof Error ? error.message : String(error)))
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
            if (value >= 8 && value <= 40) save(() => saveEditorSettings({ fontSize: value }))
          }}
        />
      </SettingRow>
      <SettingRow title={t("workspace.fontFamily")} aligned>
        <Input
          aria-label={t("workspace.fontFamily")}
          value={settings.fontFamily}
          maxLength={200}
          onChange={event => save(() => saveEditorSettings({ fontFamily: event.target.value }))}
        />
      </SettingRow>
      {(["fontLigatures", "wordWrap", "minimap", "lineNumbers", "renderWhitespace"] as const).map(key => (
        <SettingRow key={key} title={t(`workspace.${key}`)}>
          <Switch
            aria-label={t(`workspace.${key}`)}
            checked={settings[key]}
            onCheckedChange={value => save(() => saveEditorSettings({ [key]: value }))}
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
