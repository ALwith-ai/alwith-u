import { withChatResources } from "@alwith/module-chat/locales"
import { createInstance } from "i18next"
import { expect, test } from "vitest"

test("adding chat translations does not replace application strings", async () => {
  const instance = createInstance()
  await instance.init({
    lng: "zh-CN",
    fallbackLng: "en",
    resources: withChatResources({ "zh-CN": { translation: { name: "ALwith U" } } })
  })
  expect(instance.t("name")).toBe("ALwith U")
  expect(instance.t("stream.codex.worked", { ns: "alwithChat" })).toBe("已处理")
})
