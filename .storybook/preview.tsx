import "../src/index.css"
import { withThemeByClassName } from "@storybook/addon-themes"
import type { Preview } from "@storybook/react-vite"
import { mockIPC } from "@tauri-apps/api/mocks"
import { I18nextProvider } from "react-i18next"

import { AppDirectionProvider } from "../src/components/alwith-ui/app-direction-provider"
import { ThemeProvider } from "../src/components/theme-provider"
import i18n, { initI18n } from "../src/lib/i18n"
import { settingsStore } from "../src/lib/settings-store"

mockIPC((command) => {
  if (command === "plugin:log|log") return
  throw new Error(`Unexpected Storybook IPC command: ${command}`)
})

let settingsRevision = 0

const preview: Preview = {
  tags: ["autodocs"],
  globalTypes: {
    locale: {
      toolbar: {
        icon: "globe",
        items: [
          { value: "en", title: "English" },
          { value: "zh-CN", title: "简体中文" },
          { value: "ar", title: "العربية (RTL)" }
        ]
      }
    }
  },
  initialGlobals: { locale: "en" },
  loaders: [
    async ({ globals }) => {
      settingsStore.accept({
        revision: ++settingsRevision,
        values: { "appearance.theme": globals.theme === "dark" ? "dark" : "light" },
        browserMigrated: true
      })
      const locale = globals.locale as string
      if (!i18n.isInitialized) await initI18n(locale)
      else await i18n.changeLanguage(locale)
    }
  ],
  decorators: [
    withThemeByClassName({ themes: { light: "light", dark: "dark" }, defaultTheme: "light" }),
    (Story, context) => (
      <I18nextProvider i18n={i18n}>
        <AppDirectionProvider>
          <ThemeProvider>
            <div
              className={
                context.parameters.layout === "fullscreen"
                  ? "bg-background text-foreground"
                  : "mx-auto max-w-3xl bg-background p-4 text-foreground"
              }
              data-stream-style="codexUI"
            >
              <Story />
            </div>
          </ThemeProvider>
        </AppDirectionProvider>
      </I18nextProvider>
    )
  ],
  parameters: { layout: "padded", a11y: { test: "error" } }
}

export default preview
