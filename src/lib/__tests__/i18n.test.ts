import { expect, test } from "bun:test"
import { chatLocales } from "@alwith/module-chat/locales"
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

test.serial("every English UI message has an explicit Simplified Chinese translation", async () => {
  await initI18n("zh-CN")

  expect(resourceContract(zhCN)).toEqual(resourceContract(en))
  expect(resourceContract(chatLocales["zh-CN"])).toEqual(resourceContract(chatLocales.en))
})

test.serial("incomplete languages display the complete English UI without mixing translations", async () => {
  for (const { code } of LANGUAGES) {
    if (code === "en" || code === "zh-CN") continue
    await initI18n(code)

    expect(i18n.language).toBe(code)
    expect(i18n.t("settings.title")).toBe("Settings")
    expect(i18n.t("actions.copy", { ns: "alwithChat" })).toBe("Copy")
  }
})
