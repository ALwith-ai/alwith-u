import { render } from "@testing-library/react"
import { expect, test } from "vitest"

import i18n, { initI18n, LANGUAGES } from "@/lib/i18n"

import { useChatActivityHost } from "../activity-host"

function HostLanguage() {
  const host = useChatActivityHost()
  return <span>{host.i18n.language}</span>
}

test.each(LANGUAGES)("chat activity formatting uses the selected $code locale", async ({ code }) => {
  await initI18n(code)
  const view = render(<HostLanguage />)

  expect(view.getByText(code)).toBeTruthy()
  view.unmount()
})

test("chat activity formatting uses English for an unsupported locale", async () => {
  await initI18n("en")
  await i18n.changeLanguage("xx")
  const view = render(<HostLanguage />)

  expect(view.getByText("en")).toBeTruthy()
})
