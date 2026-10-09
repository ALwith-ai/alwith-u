import { chatLocales } from "@alwith/module-chat/locales"
import { expect, test } from "vitest"
import i18n, { initI18n, LANGUAGES } from "@/lib/i18n"
import en from "@/locales/en.json"
import zhCN from "@/locales/zh-CN.json"

type TranslationTree = { readonly [key: string]: string | TranslationTree }

function leafMessages(tree: TranslationTree, prefix = ""): Array<[string, string]> {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix === "" ? key : `${prefix}.${key}`
    return typeof value === "string" ? [[path, value] as [string, string]] : leafMessages(value, path)
  })
}

function resourceContract(tree: TranslationTree): Array<[string, string[]]> {
  return leafMessages(tree)
    .map(([key, value]): [string, string[]] => [
      key,
      [...value.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map(match => match[1] ?? "").sort()
    ])
    .sort(([left], [right]) => left.localeCompare(right))
}

test("every English UI message has an explicit Simplified Chinese translation", async () => {
  await initI18n("zh-CN")

  expect(resourceContract(zhCN)).toEqual(resourceContract(en))
  expect(resourceContract(chatLocales["zh-CN"])).toEqual(resourceContract(chatLocales.en))
  expect(i18n.t("chat.project.chatCount", { count: 1 })).toBe("1 个会话")
  expect(i18n.t("chat.project.chatCount", { count: 7 })).toBe("7 个会话")
})

test("the Simplified Chinese activity sidebar uses translated labels", async () => {
  await initI18n("zh-CN")

  expect(i18n.t("sidebar.activity")).toBe("活动")
  expect(i18n.t("sidebar.background")).toBe("后台")
})

test("supported locales use the ALwith U product name", async () => {
  for (const language of ["en", "zh-CN"]) {
    await initI18n(language)

    expect(i18n.t("app.name")).toBe("ALwith U")
    expect(i18n.t("platformAuth.signOut")).toContain("ALwith U")
  }
})

test("incomplete languages display the complete English UI without mixing translations", async () => {
  for (const { code } of LANGUAGES) {
    if (code === "en" || code === "zh-CN") continue
    await initI18n(code)

    expect(i18n.language).toBe(code)
    expect(i18n.t("settings.title")).toBe("Settings")
    expect(i18n.t("actions.copy", { ns: "alwithChat" })).toBe("Copy")
  }
})
