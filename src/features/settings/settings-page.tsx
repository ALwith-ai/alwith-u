// The settings window (ALwith Desktop's SettingsPage): section list in the sidebar, one
// section on the right. The initial section comes from `?tab=`, later switches from the
// `settings-change-tab` event; closing the window hides it so reopening is instant.
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { listen } from "@tauri-apps/api/event"
import { BlocksIcon, ContrastIcon, CpuIcon, InfoIcon, SlidersHorizontalIcon, UserIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { AuxWindowShell } from "@/components/alwith-ui/aux-window-shell"
import { Pane } from "@/components/alwith-ui/pane"
import { MENU_HIGHLIGHT } from "@/components/alwith-ui/surface-highlight"
import { NavigationItemButton } from "@/features/layout/components/navigation/navigation-item"
import { NavigationStack } from "@/features/layout/components/navigation/navigation-stack"
import { SETTINGS_CHANGE_TAB, SETTINGS_SECTIONS, type SettingsSection } from "@/lib/window-manager"
import { AboutSection } from "./sections/about-section"
import { AppearanceSection } from "./sections/appearance-section"
import { GeneralSection } from "./sections/general-section"
import { ProviderSection } from "./sections/provider-section"
import { AccountSection } from "./sections/account-section"
import { ExtensionsSection } from "@/features/extensions/extensions-section"
import { ExtensionMount } from "@/features/extensions/extension-view"
import { ExtensionSettingsNavigation, ExtensionSettingsContent } from "@/features/extensions/extension-outlets"
import { useExtensions } from "@/features/extensions/runtime"

const ICONS: Record<SettingsSection, typeof InfoIcon> = {
  account: UserIcon,
  general: SlidersHorizontalIcon,
  appearance: ContrastIcon,
  provider: CpuIcon,
  extensions: BlocksIcon,
  about: InfoIcon
}

function isSection(value: string | null): value is SettingsSection {
  return value !== null && (SETTINGS_SECTIONS as string[]).includes(value)
}

export function SettingsPage() {
  const { host } = useExtensions()
  const [extensionSection, setExtensionSection] = useState<string | null>(null)
  const { t } = useTranslation()
  const [section, setSection] = useState<SettingsSection>(() => {
    const tab = new URLSearchParams(window.location.search).get("tab")
    return isSection(tab) ? tab : "general"
  })

  useEffect(() => {
    const stop = listen<string>(SETTINGS_CHANGE_TAB, event => {
      if (isSection(event.payload)) {
        setSection(event.payload)
        setExtensionSection(null)
      }
    })
    return () => void stop.then(fn => fn())
  }, [])

  // Close = hide: the window keeps its state and the next open is instant (VS Code and
  // Obsidian do the same).
  useEffect(() => {
    const win = getCurrentWebviewWindow()
    const stop = win.onCloseRequested(event => {
      event.preventDefault()
      void win.hide()
    })
    return () => void stop.then(fn => fn())
  }, [])

  const content =
    extensionSection !== null ? (
      <ExtensionSettingsContent
        id={extensionSection}
        views={host.views}
        renderView={view => <ExtensionMount key={view.id} id={view.id} />}
      />
    ) : (
      (() => {
        switch (section) {
          case "account":
            return <AccountSection />
          case "general":
            return <GeneralSection />
          case "appearance":
            return <AppearanceSection />
          case "provider":
            return <ProviderSection />
          case "about":
            return <AboutSection />
          case "extensions":
            return <ExtensionsSection />
        }
      })()
    )

  const sidebar = (
    <>
      <div className="px-4 pt-8 pb-8 text-base font-semibold">{t("settings.title")}</div>
      <NavigationStack className="min-h-0 overflow-y-auto px-3 pb-4">
        {SETTINGS_SECTIONS.map(id => {
          const Icon = ICONS[id]
          return (
            <NavigationItemButton
              key={id}
              className={MENU_HIGHLIGHT}
              active={extensionSection === null && id === section}
              onClick={() => {
                setSection(id)
                setExtensionSection(null)
              }}>
              <Icon />
              <span>{t(`settings.${id}`)}</span>
            </NavigationItemButton>
          )
        })}
        <ExtensionSettingsNavigation views={host.views} activeId={extensionSection} onSelect={setExtensionSection} />
      </NavigationStack>
    </>
  )

  return (
    <AuxWindowShell
      title={
        extensionSection === null
          ? t(`settings.${section}`)
          : (host.views.find(view => view.id === extensionSection && view.kind === "settingsPages")?.title ??
            t("extensions.unavailable"))
      }
      sidebar={sidebar}
      sidebarClassName="bg-muted w-60 [--navigation-row-height:36px]">
      <Pane viewportClassName="px-6 pt-3 pb-6">{content}</Pane>
    </AuxWindowShell>
  )
}
