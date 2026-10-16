import { gamepadResources } from "@alwith/module-gamepad/locales"
import { vibemonLocales } from "@alwith/module-auth/pets/locales"
import { chatLocales } from "@alwith/module-chat/locales"
import i18n, { type Resource } from "i18next"
import { initReactI18next } from "react-i18next"
import ar from "@/locales/ar.json"
import de from "@/locales/de.json"
import en from "@/locales/en.json"
import es from "@/locales/es.json"
import fr from "@/locales/fr.json"
import hi from "@/locales/hi.json"
import id from "@/locales/id.json"
import it from "@/locales/it.json"
import ja from "@/locales/ja.json"
import ko from "@/locales/ko.json"
import ptBR from "@/locales/pt-BR.json"
import ru from "@/locales/ru.json"
import zhCN from "@/locales/zh-CN.json"

/** Supported application languages, shared with ALwith Desktop. */
export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "zh-CN", label: "简体中文" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "it", label: "Italiano" },
  { code: "es", label: "Español" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "ru", label: "Русский" },
  { code: "ar", label: "العربية" },
  { code: "pt-BR", label: "Português (Brasil)" },
  { code: "hi", label: "हिन्दी" },
  { code: "id", label: "Bahasa Indonesia" }
] as const

export type LanguageCode = (typeof LANGUAGES)[number]["code"]

export function isLanguageCode(value: string): value is LanguageCode {
  return LANGUAGES.some(language => language.code === value)
}

/** Desktop's mapping of a system locale to the closest supported language. */
function mapSystemLocale(value: string): LanguageCode | null {
  const lower = value.toLowerCase()
  if (lower.startsWith("zh")) return "zh-CN"
  if (lower.startsWith("fr")) return "fr"
  if (lower.startsWith("de")) return "de"
  if (lower.startsWith("it")) return "it"
  if (lower.startsWith("es")) return "es"
  if (lower.startsWith("ja")) return "ja"
  if (lower.startsWith("ko")) return "ko"
  if (lower.startsWith("ru")) return "ru"
  if (lower.startsWith("ar")) return "ar"
  if (lower.startsWith("pt")) return "pt-BR"
  if (lower.startsWith("hi")) return "hi"
  if (lower.startsWith("id")) return "id"
  return null
}

function systemLanguage(): LanguageCode {
  return mapSystemLocale(navigator.language) ?? "en"
}

const translations = { en, "zh-CN": zhCN, fr, de, it, es, ja, ko, ru, ar, "pt-BR": ptBR, hi, id } satisfies Record<
  LanguageCode,
  object
>

export function initI18n(language: string | null): Promise<unknown> {
  const resources: Resource = Object.fromEntries(
    LANGUAGES.map(({ code }) => [
      code,
      {
        translation: translations[code],
        gamepad: gamepadResources[code],
        alwithChat: chatLocales[code],
        ...(code === "en" || code === "zh-CN" ? vibemonLocales[code] : {})
      }
    ])
  )

  // Window actions belong to U; pet catalogs are supplied by the shared module.
  resources.en = {
    ...resources.en,
    common: {
      ...vibemonLocales.en.common,
      navigation: { mainWindow: "Main window", chatWindow: "Floating window" },
      petMode: {
        ...vibemonLocales.en.common.petMode,
        enter: "Collapse to Vibémon",
        openMain: "Open conversation in main window",
        openChat: "Open conversation in floating window"
      }
    }
  }
  resources["zh-CN"] = {
    ...resources["zh-CN"],
    common: {
      ...vibemonLocales["zh-CN"].common,
      navigation: { mainWindow: "主窗", chatWindow: "独立浮窗" },
      petMode: {
        ...vibemonLocales["zh-CN"].common.petMode,
        enter: "收起到 Vibémon",
        openMain: "在主窗中打开会话",
        openChat: "在独立浮窗中打开会话"
      }
    }
  }

  return i18n.use(initReactI18next).init({
    resources,
    supportedLngs: LANGUAGES.map(({ code }) => code),
    lng: language !== null && isLanguageCode(language) ? language : systemLanguage(),
    fallbackLng: "en",
    interpolation: { escapeValue: false }
  })
}

// Tool windows can register their namespace after the main app initializes.
export function registerGamepadLocales(): void {
  for (const [language, catalog] of Object.entries(gamepadResources)) {
    i18n.addResourceBundle(language, "gamepad", catalog)
  }
}

export default i18n
