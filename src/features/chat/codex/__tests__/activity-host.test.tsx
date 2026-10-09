import { render } from "@testing-library/react"
import { expect, test } from "vitest"
import { initI18n } from "@/lib/i18n"
import { useChatActivityHost } from "../activity-host"

function HostLanguage() {
  const host = useChatActivityHost()
  return <span>{host.i18n.language}</span>
}

test("chat activity formatting uses the resolved English fallback locale", async () => {
  await initI18n("ar")
  const view = render(<HostLanguage />)

  expect(view.getByText("en")).toBeTruthy()
})
