import { useTranslation } from "react-i18next"
import { useStore } from "zustand"
import { useTheme, type Theme } from "@/components/theme-provider"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  NAVIGATION_INSTRUMENT_GROUPS,
  NAVIGATION_SOUND_MODES,
  type NavigationInstrument,
  type NavigationSoundMode,
  navigationInstrumentLabel
} from "@/features/chat/codex/navigation-instruments"
import {
  navigationSoundStore,
  setNavigationInstrument,
  setNavigationSoundMode
} from "@/features/chat/codex/navigation-sound-store"
import { Separator } from "@/components/ui/separator"
import { SettingGroup, SettingRow } from "./shared"

export function AppearanceSection() {
  const { t } = useTranslation()
  const { theme, setTheme } = useTheme()
  const navigationInstrument = useStore(navigationSoundStore, state => state.instrument)
  const navigationSoundMode = useStore(navigationSoundStore, state => state.soundMode)
  const navigationInstrumentGroup = NAVIGATION_INSTRUMENT_GROUPS.find(group =>
    (group.instruments as readonly NavigationInstrument[]).includes(navigationInstrument)
  ) as (typeof NAVIGATION_INSTRUMENT_GROUPS)[number]
  const themeOptions: Array<[Theme, string]> = [
    ["light", t("settings.themeLight")],
    ["system", t("settings.themeSystem")],
    ["dark", t("settings.themeDark")]
  ]
  return (
    <SettingGroup>
      <SettingRow title={t("settings.theme")}>
        <ToggleGroup
          value={[theme]}
          onValueChange={values => values[0] && setTheme(values[0] as Theme)}
          variant="outline"
          aria-label={t("settings.theme")}>
          {themeOptions.map(([value, label]) => (
            <ToggleGroupItem key={value} value={value}>
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </SettingRow>
      <Separator />
      <SettingRow title={t("settings.navigationSoundMode")}>
        <Select
          value={navigationSoundMode}
          onValueChange={value => {
            if (value === null) throw new Error("导航旋律不能为空")
            void setNavigationSoundMode(value as NavigationSoundMode)
          }}>
          <SelectTrigger className="w-32">
            <SelectValue>{t(`settings.navigationSoundModes.${navigationSoundMode}`)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {NAVIGATION_SOUND_MODES.map(mode => (
                <SelectItem key={mode} value={mode}>
                  {t(`settings.navigationSoundModes.${mode}`)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </SettingRow>
      <Separator />
      <SettingRow title={t("settings.navigationInstrument")}>
        <div className="flex items-center gap-2">
          <Select
            value={navigationInstrumentGroup.id}
            onValueChange={value => {
              if (value === null) throw new Error("音色类别不能为空")
              const group = NAVIGATION_INSTRUMENT_GROUPS.find(
                candidate => candidate.id === value
              ) as (typeof NAVIGATION_INSTRUMENT_GROUPS)[number]
              void setNavigationInstrument(group.instruments[0])
            }}>
            <SelectTrigger className="w-32">
              <SelectValue>{t(`settings.navigationInstrumentGroups.${navigationInstrumentGroup.id}`)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {NAVIGATION_INSTRUMENT_GROUPS.map(group => (
                  <SelectItem key={group.id} value={group.id}>
                    {t(`settings.navigationInstrumentGroups.${group.id}`)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select
            value={navigationInstrument}
            onValueChange={value => {
              if (value === null) throw new Error("导航音色不能为空")
              void setNavigationInstrument(value as NavigationInstrument)
            }}>
            <SelectTrigger className="w-48">
              <SelectValue>{navigationInstrumentLabel(navigationInstrument)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {navigationInstrumentGroup.instruments.map(instrument => (
                  <SelectItem key={instrument} value={instrument}>
                    {navigationInstrumentLabel(instrument)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </SettingRow>
    </SettingGroup>
  )
}
