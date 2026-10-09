import "../src/index.css"
import { useEffect, type ReactNode } from "react"
import type { Preview } from "@storybook/react-vite"
import { withThemeByClassName } from "@storybook/addon-themes"
import { I18nextProvider } from "react-i18next"
import { AppDirectionProvider } from "../src/components/alwith-ui/app-direction-provider"
import { ThemeProvider, useTheme } from "../src/components/theme-provider"
import i18n, { initI18n } from "../src/lib/i18n"

function ThemeSync({ theme, children }: { theme: "light" | "dark"; children: ReactNode }) {
  const { setTheme } = useTheme()
  useEffect(() => setTheme(theme), [theme, setTheme])
  return children
}

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
      if (!i18n.isInitialized) await initI18n(globals.locale)
      else await i18n.changeLanguage(globals.locale)
    }
  ],
  decorators: [
    withThemeByClassName({ themes: { light: "light", dark: "dark" }, defaultTheme: "light" }),
    (Story, context) => (
      <I18nextProvider i18n={i18n}>
        <AppDirectionProvider>
          <ThemeProvider>
            <ThemeSync theme={context.globals.theme === "dark" ? "dark" : "light"}>
              <div className="bg-background text-foreground mx-auto max-w-3xl p-4" data-stream-style="codexUI">
                <Story />
              </div>
            </ThemeSync>
          </ThemeProvider>
        </AppDirectionProvider>
      </I18nextProvider>
    )
  ],
  parameters: { layout: "padded", a11y: { test: "error" } }
}

export default preview
