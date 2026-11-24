import "./fixtures/native"
import { resetNative } from "./fixtures/native"
import { disposePlaybackClock } from "./fixtures/playback-clock"
import "../src/index.css"
import "./preview.css"
import { Description, Title } from "@storybook/addon-docs/blocks"
import { withThemeByClassName } from "@storybook/addon-themes"
import type { Preview } from "@storybook/react-vite"
import { I18nextProvider } from "react-i18next"
import { configure } from "storybook/test"

import { AppDirectionProvider } from "../src/components/alwith-ui/app-direction-provider"
import { ThemeProvider } from "../src/components/theme-provider"
import i18n, { initI18n } from "../src/lib/i18n"
import { settingsStore } from "../src/lib/settings-store"

configure({ asyncUtilTimeout: 5000 })

const preview: Preview = {
  tags: ["!autodocs"],
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
  initialGlobals: { locale: "zh-CN", theme: "light" },
  loaders: [
    async ({ globals }) => {
      disposePlaybackClock()
      resetNative(undefined, undefined, globals.theme === "dark" ? "dark" : "light")
      await settingsStore.read()
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
                context.parameters.productPage
                  ? "h-dvh w-full overflow-hidden bg-sidebar text-foreground"
                  : context.parameters.layout === "fullscreen"
                    ? "bg-background text-foreground"
                    : "mx-auto max-w-3xl bg-background p-4 text-foreground"
              }
              data-stream-style="codexUI"
            >
              <Story key={JSON.stringify([context.id, context.args, context.globals])} />
            </div>
          </ThemeProvider>
        </AppDirectionProvider>
      </I18nextProvider>
    )
  ],
  parameters: {
    docs: {
      page: () => (
        <>
          <Title />
          <Description of="meta" />
        </>
      ),
      story: { inline: false, height: "720px" }
    },
    layout: "padded",
    a11y: { test: "error" }
  }
}

export default preview
