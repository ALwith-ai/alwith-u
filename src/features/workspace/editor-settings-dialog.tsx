import { useTranslation } from "react-i18next"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { iconThemes, type IconTheme } from "./workspace-state"
import type { EditorSettings } from "./editor-settings"

export function EditorSettingsDialog({
  open,
  onOpenChange,
  settings,
  onChange,
  iconTheme,
  onIconThemeChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  settings: EditorSettings
  onChange: (settings: EditorSettings) => void
  iconTheme: IconTheme
  onIconThemeChange: (theme: IconTheme) => void
}) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("workspace.editorSettings")}</DialogTitle>
        </DialogHeader>
        <label className="flex items-center justify-between gap-4">
          {t("workspace.fontSize")}
          <Input
            className="w-24"
            type="number"
            min={8}
            max={40}
            value={settings.fontSize}
            onChange={event => {
              const value = event.target.valueAsNumber
              if (value >= 8 && value <= 40) onChange({ ...settings, fontSize: value })
            }}
          />
        </label>
        <label className="flex items-center justify-between gap-4">
          {t("workspace.fontFamily")}
          <Input
            className="w-56"
            value={settings.fontFamily}
            maxLength={200}
            onChange={event => onChange({ ...settings, fontFamily: event.target.value })}
          />
        </label>
        {(["fontLigatures", "wordWrap", "minimap", "lineNumbers", "renderWhitespace"] as const).map(key => (
          <label key={key} className="flex items-center justify-between gap-4">
            {t(`workspace.${key}`)}
            <Switch checked={settings[key]} onCheckedChange={value => onChange({ ...settings, [key]: value })} />
          </label>
        ))}
        <div className="flex items-center justify-between gap-4">
          <span>{t("workspace.iconTheme")}</span>
          <Select
            value={iconTheme}
            onValueChange={value => {
              if (value === null || !iconThemes.includes(value as IconTheme)) throw new Error("Unknown file icon theme")
              onIconThemeChange(value as IconTheme)
            }}>
            <SelectTrigger className="w-56" aria-label={t("workspace.iconTheme")}>
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
        </div>
      </DialogContent>
    </Dialog>
  )
}
