import { CodexWorkSection } from "@alwith/module-chat/activity"
import { ActivityHostProvider, type ActivityHost } from "@alwith/module-chat/activity-host"
import { CodexPlan } from "@alwith/module-chat/plan"
import { fireEvent, render } from "@testing-library/react"
import { afterEach, expect, test } from "bun:test"
import { installDom } from "./dom-environment"

installDom()
const mounted: Array<ReturnType<typeof render>> = []
afterEach(() => { for (const view of mounted.splice(0)) view.unmount() })

const host: ActivityHost = {
  t: key => key,
  i18n: { language: "en" },
  openLink: () => {},
  Markdown: ({ text }) => <p>{text}</p>
}

test("Desktop work-section disclosure survives virtualized unmounts", () => {
  const content = (
    <ActivityHostProvider host={host}>
      <CodexWorkSection stateKey="u-shared-work-test" active={false}>
        <span>Tool details</span>
      </CodexWorkSection>
    </ActivityHostProvider>
  )
  const view = render(content)
  mounted.push(view)
  const toggle = view.getByRole("button", { name: "stream.codex.worked" })
  expect(toggle.getAttribute("aria-expanded")).toBe("false")
  fireEvent.click(toggle)
  expect(toggle.getAttribute("aria-expanded")).toBe("true")
  view.unmount()
  const restored = render(content)
  mounted.push(restored)
  expect(restored.getByRole("button").getAttribute("aria-expanded")).toBe("true")
})

test("Desktop plan renders completed and active entries from ACP", () => {
  const view = render(<CodexPlan entries={[
    { content: "Read", status: "completed", priority: "medium" },
    { content: "Build", status: "in_progress", priority: "medium" }
  ]} />)
  mounted.push(view)
  expect(view.getByText("1/2")).toBeDefined()
  expect(view.container.querySelector('[data-status="completed"]')?.textContent).toBe("Read")
  expect(view.container.querySelector('[data-status="in_progress"]')?.textContent).toBe("Build")
})
