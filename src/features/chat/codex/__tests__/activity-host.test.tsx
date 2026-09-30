import { expect, test } from "bun:test"
import { render } from "@testing-library/react"
import { initI18n } from "@/lib/i18n"
import { useChatActivityHost } from "../activity-host"
import { installDom } from "./dom-environment"

installDom()

function HostLanguage() {
  const host = useChatActivityHost()
  return <span>{host.i18n.language}</span>
}

test("chat activity formatting uses the resolved English fallback locale", async () => {
  await initI18n("ar")
  const view = render(<HostLanguage />)

  expect(view.getByText("en")).toBeTruthy()
})
