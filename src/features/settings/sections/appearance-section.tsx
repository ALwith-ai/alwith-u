import { ThemeModePicker } from "@alwith/module-desktop-shell/settings"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { useStore } from "zustand"

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/alwith-ui/select"
import { useTheme } from "@/components/theme-provider"
import {
  NAVIGATION_INSTRUMENT_GROUPS,
  NAVIGATION_SOUND_MODES,
  type NavigationInstrument,
  navigationInstrumentLabel
} from "@/features/chat/codex/navigation-instruments"
import {
  navigationSoundStore,
  setNavigationInstrument,
  setNavigationSoundMode
} from "@/features/chat/codex/navigation-sound-store"
import { setZoomLevel, ZOOM_LEVELS, zoomStore } from "@/lib/zoom"

import { SettingGroup, SettingRow } from "./shared"

export function AppearanceSection() {
  const { t } = useTranslation()
  const { theme, setTheme } = useTheme()
  const zoom = useStore(zoomStore, (state) => state.level)
  const navigationInstrument = useStore(navigationSoundStore, (state) => state.instrument)
  const navigationSoundMode = useStore(navigationSoundStore, (state) => state.soundMode)
  const navigationInstrumentGroup = NAVIGATION_INSTRUMENT_GROUPS.find((group) =>
    (group.instruments as readonly NavigationInstrument[]).includes(navigationInstrument)
  ) as (typeof NAVIGATION_INSTRUMENT_GROUPS)[number]
  return (
    <SettingGroup>
      <SettingRow title={t("settings.theme")}>
        <ThemeModePicker
          value={theme}
          onChange={setTheme}
          labels={{ light: t("settings.themeLight"), system: t("settings.themeSystem"), dark: t("settings.themeDark") }}
          label={t("settings.theme")}
        />
      </SettingRow>
      <SettingRow title={t("zoom.label")} aligned>
        <Select
          value={String(zoom)}
          onValueChange={(value) => {
            if (value === null) throw new Error("Zoom level cannot be empty")
            void setZoomLevel(Number(value)).catch((error: unknown) =>
              toast.error(error instanceof Error ? error.message : String(error))
            )
          }}
        >
          <SelectTrigger className="w-full" aria-label={t("zoom.label")}>
            <SelectValue>{Math.round(zoom * 100)}%</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {ZOOM_LEVELS.map((level) => (
                <SelectItem key={level} value={String(level)}>
                  {Math.round(level * 100)}%
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </SettingRow>
      <SettingRow title={t("settings.navigationSoundMode")} aligned>
        <Select
          value={navigationSoundMode}
          onValueChange={(value) => {
            if (value === null) throw new Error("导航旋律不能为空")
            void setNavigationSoundMode(value)
          }}
        >
          <SelectTrigger className="w-full" aria-label={t("settings.navigationSoundMode")}>
            <SelectValue>{t(`settings.navigationSoundModes.${navigationSoundMode}`)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {NAVIGATION_SOUND_MODES.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {t(`settings.navigationSoundModes.${mode}`)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </SettingRow>
      <SettingRow title={t("settings.navigationInstrument")} aligned>
        <div className="grid grid-cols-2 items-center gap-2">
          <Select
            value={navigationInstrumentGroup.id}
            onValueChange={(value) => {
              if (value === null) throw new Error("音色类别不能为空")
              const group = NAVIGATION_INSTRUMENT_GROUPS.find(
                (candidate) => candidate.id === value
              ) as (typeof NAVIGATION_INSTRUMENT_GROUPS)[number]
              void setNavigationInstrument(group.instruments[0])
            }}
          >
            <SelectTrigger
              className="w-full"
              aria-label={t(`settings.navigationInstrumentGroups.${navigationInstrumentGroup.id}`)}
            >
              <SelectValue>{t(`settings.navigationInstrumentGroups.${navigationInstrumentGroup.id}`)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {NAVIGATION_INSTRUMENT_GROUPS.map((group) => (
                  <SelectItem key={group.id} value={group.id}>
                    {t(`settings.navigationInstrumentGroups.${group.id}`)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select
            value={navigationInstrument}
            onValueChange={(value) => {
              if (value === null) throw new Error("导航音色不能为空")
              void setNavigationInstrument(value)
            }}
          >
            <SelectTrigger className="w-full" aria-label={t("settings.navigationInstrument")}>
              <SelectValue>{navigationInstrumentLabel(navigationInstrument)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {navigationInstrumentGroup.instruments.map((instrument) => (
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
