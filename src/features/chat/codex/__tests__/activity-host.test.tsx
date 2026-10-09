import { render } from "@testing-library/react"
import { expect, test } from "vitest"
import i18n, { initI18n, LANGUAGES } from "@/lib/i18n"
import { useChatActivityHost } from "../activity-host"

function HostLanguage() {
  const host = useChatActivityHost()
  return <span>{host.i18n.language}</span>
}

test("chat activity formatting uses the resolved English fallback locale", async () => {
  await initI18n("en")
  // Pick a listed language that ships no resources yet, whichever one that is as locales get registered.
  const unregistered = LANGUAGES.find(language => !i18n.hasResourceBundle(language.code, "translation"))
  if (unregistered === undefined) throw new Error("Every listed language has resources; this fallback test is obsolete")
  await i18n.changeLanguage(unregistered.code)
  const view = render(<HostLanguage />)

  expect(view.getByText("en")).toBeTruthy()
})
