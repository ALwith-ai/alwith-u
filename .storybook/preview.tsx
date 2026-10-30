import "./fixtures/native"
import { disposePlaybackClock } from "./fixtures/playback-clock"
import "../src/index.css"
import { withThemeByClassName } from "@storybook/addon-themes"
import type { Preview } from "@storybook/react-vite"
import { type ReactNode, useEffect } from "react"
import { I18nextProvider } from "react-i18next"
import { configure } from "storybook/test"

import { AppDirectionProvider } from "../src/components/alwith-ui/app-direction-provider"
import { ThemeProvider, useTheme } from "../src/components/theme-provider"
import i18n, { initI18n } from "../src/lib/i18n"

function ThemeSync({ theme, children }: { theme: "light" | "dark"; children: ReactNode }) {
  const { setTheme } = useTheme()
  useEffect(() => setTheme(theme), [theme, setTheme])
  return children
}

configure({ asyncUtilTimeout: 5000 })

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
  initialGlobals: { locale: "zh-CN", theme: "light" },
  loaders: [
    async ({ globals }) => {
      disposePlaybackClock()
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
            <ThemeSync theme={context.globals.theme === "dark" ? "dark" : "light"}>
              <div
                className={
                  context.parameters.productPage
                    ? "h-dvh w-full overflow-hidden bg-sidebar text-foreground"
                    : "mx-auto max-w-3xl bg-background p-4 text-foreground"
                }
                data-stream-style="codexUI"
              >
                <Story key={JSON.stringify([context.id, context.args, context.globals])} />
              </div>
            </ThemeSync>
          </ThemeProvider>
        </AppDirectionProvider>
      </I18nextProvider>
    )
  ],
  parameters: {
    docs: { story: { inline: false } },
    layout: "padded",
    a11y: { test: "error" },
    options: {
      storySort: {
        order: [
          "页面",
          [
            "账号与登录",
            "主窗整体",
            "主窗聊天",
            "文件树和预览区",
            "浮窗聊天",
            "负一屏",
            ["插件", "扩展", "宠物伙伴", "归档"],
            "设置页",
            "Gamepad",
            "其他"
          ],
          "流程",
          [
            "账号与登录",
            "主窗整体",
            "主窗聊天",
            "文件树和预览区",
            "浮窗聊天",
            "负一屏",
            ["插件", "扩展", "宠物伙伴", "归档"],
            "设置页",
            "Gamepad",
            "其他"
          ]
        ],
        method: "alphabetical",
        locales: "zh-CN"
      }
    }
  }
}

export default preview
