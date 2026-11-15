import i18n from "i18next"
import { initReactI18next } from "react-i18next"

import zhCN from "@/locales/zh-CN.json"

// The suites ask for controls by the names the Chinese catalog gives them.
await i18n.use(initReactI18next).init({
  lng: "zh-CN",
  resources: { "zh-CN": { translation: zhCN } },
  interpolation: { escapeValue: false }
})
