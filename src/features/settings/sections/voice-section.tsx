import { VoiceSettingsForm, type VoiceSettingsSlots } from "@alwith/module-voice/react"
import { type ReactNode, useState, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { openExternal } from "@/lib/open"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { createVoiceSettingsHost, loadVoiceSettings, saveVoiceEnabled, voiceProfiles } from "@/features/voice/settings"
import { useVoiceEnabled } from "@/features/voice/use-voice-enabled"
import { SettingGroup, SettingRow } from "./shared"
const slots: VoiceSettingsSlots = {
  Group: SettingGroup,
  Row: SettingRow,
  Input,
  Textarea,
  Switch,
  Button,
  RemoveKeyButton: props => (
    <Button
      {...props}
      variant="link"
      className="text-muted-foreground hover:text-foreground h-auto p-0 text-sm font-normal"
    />
  ),
  KeyLink: ({ href, children, ...props }) => (
    <a
      {...props}
      href={href}
      className="text-muted-foreground text-sm underline-offset-4 hover:underline"
      onClick={event => {
        event.preventDefault()
        // The shell plugin also intercepts _blank links on body, ignoring defaultPrevented.
        event.stopPropagation()
        if (href === undefined) throw new Error("missing_voice_key_url")
        void openExternal(href).catch((error: unknown) =>
          toast.error(error instanceof Error ? error.message : String(error))
        )
      }}>
      {children}
    </a>
  ),
  Select: ({ label, value, options, onChange }) => (
    <Select
      items={options}
      value={value}
      onValueChange={next => {
        if (next !== null) onChange(next)
      }}>
      <SelectTrigger aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(option => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
export function VoiceSection(): ReactNode {
  const host = useMemo(createVoiceSettingsHost, [])
  const { t } = useTranslation()
  const enabled = useVoiceEnabled()
  const [saving, setSaving] = useState(false)
  const onSaved = async (): Promise<void> => {
    try {
      const settings = await loadVoiceSettings()
      const profiles = await voiceProfiles()
      if (profiles[settings.provider]) toast.success(t("voice.saved"))
      else toast.info(t("voice.configureKey"))
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }
  const changeEnabled = async (value: boolean): Promise<void> => {
    setSaving(true)
    try {
      await saveVoiceEnabled(value)
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }
  return (
    <>
      <SettingGroup>
        <SettingRow title={t("voice.enabled")}>
          <Switch
            aria-label={t("voice.enabled")}
            checked={enabled === true}
            disabled={enabled === null || saving}
            onCheckedChange={value => void changeEnabled(value)}
          />
        </SettingRow>
        <SettingRow title={t("voice.shortcut")} desc={t("voice.shortcutHint")}>
          <Kbd>{t("voice.shortcutKey")}</Kbd>
        </SettingRow>
      </SettingGroup>
      <VoiceSettingsForm
        host={host}
        slots={slots}
        text={(key, values) => t(`voice.${key}`, values)}
        onError={error => toast.error(error instanceof Error ? error.message : String(error))}
        onSaved={() => void onSaved()}
      />
    </>
  )
}
