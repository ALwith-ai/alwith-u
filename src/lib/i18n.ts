import { vibemonLocales } from "@alwith/module-vibemon/locales"
import { chatLocales } from "@alwith/module-chat/locales"
import i18n from "i18next"
import { initReactI18next } from "react-i18next"
import ar from "@/locales/ar.json"
import en from "@/locales/en.json"
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

export function initI18n(language: string | null): Promise<unknown> {
  return i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en, alwithChat: chatLocales.en, ...vibemonLocales.en },
      ar: { translation: ar, alwithChat: chatLocales.ar },
      "zh-CN": { translation: zhCN, alwithChat: chatLocales["zh-CN"], ...vibemonLocales["zh-CN"] }
    },
    lng: language !== null && isLanguageCode(language) ? language : systemLanguage(),
    fallbackLng: "en",
    interpolation: { escapeValue: false }
  })
}

export default i18n
