import { CodexWorkSection } from "@alwith/module-chat/activity"
import { type ActivityHost, ActivityHostProvider } from "@alwith/module-chat/activity-host"
import { CodexPlan } from "@alwith/module-chat/plan"
import { fireEvent, render } from "@testing-library/react"
import { afterEach, expect, test } from "vitest"

const mounted: Array<ReturnType<typeof render>> = []
afterEach(() => {
  for (const view of mounted.splice(0)) view.unmount()
})

const host: ActivityHost = {
  t: (key) => key,
  i18n: { language: "en" },
  openLink: () => {},
  Markdown: ({ text }) => <p>{text}</p>
}

test("Desktop work-section disclosure survives virtualized unmounts", () => {
  const content = (
    <ActivityHostProvider host={host}>
      <CodexWorkSection stateKey="u-shared-work-test" active={true}>
        <span>Tool details</span>
      </CodexWorkSection>
    </ActivityHostProvider>
  )
  const view = render(content)
  mounted.push(view)
  const toggle = view.getByRole("button", { name: "stream.codex.worked" })
  expect(toggle.getAttribute("aria-expanded")).toBe("true")
  fireEvent.click(toggle)
  expect(toggle.getAttribute("aria-expanded")).toBe("false")
  view.unmount()
  const restored = render(content)
  mounted.push(restored)
  expect(restored.getByRole("button").getAttribute("aria-expanded")).toBe("false")
})

test("Desktop plan renders completed and active entries from ACP", () => {
  const view = render(
    <CodexPlan
      entries={[
        { content: "Read", status: "completed", priority: "medium" },
        { content: "Build", status: "in_progress", priority: "medium" }
      ]}
    />
  )
  mounted.push(view)
  expect(view.getByText("1/2")).toBeDefined()
  expect(view.container.querySelector('[data-status="completed"]')?.textContent).toBe("Read")
  expect(view.container.querySelector('[data-status="in_progress"]')?.textContent).toBe("Build")
})

test("work collapses on completion and preserves the completed disclosure choice across remounts", () => {
  const stateKey = crypto.randomUUID()
  const content = (active: boolean) => (
    <ActivityHostProvider host={host}>
      <CodexWorkSection stateKey={stateKey} active={active}>
        <button type="button">Nested action</button>
      </CodexWorkSection>
    </ActivityHostProvider>
  )
  const view = render(content(true))
  mounted.push(view)
  const toggle = () => view.getByRole("button", { name: "stream.codex.worked" })
  expect(toggle()).toHaveAttribute("aria-expanded", "true")
  view.rerender(content(false))
  expect(toggle()).toHaveAttribute("aria-expanded", "false")
  expect(view.container.querySelector(".codex-work-grid")).toHaveAttribute("inert")
  expect(view.queryByRole("button", { name: "Nested action" })).toBeNull()
  fireEvent.click(toggle())
  expect(toggle()).toHaveAttribute("aria-expanded", "true")
  view.rerender(content(false))
  expect(toggle()).toHaveAttribute("aria-expanded", "true")
  view.unmount()
  const restored = render(content(false))
  mounted.push(restored)
  expect(restored.getByRole("button", { name: "stream.codex.worked" })).toHaveAttribute("aria-expanded", "true")
})

test("work completed while virtualized away remounts collapsed", () => {
  const stateKey = crypto.randomUUID()
  const content = (active: boolean) => (
    <ActivityHostProvider host={host}>
      <CodexWorkSection stateKey={stateKey} active={active}>
        Details
      </CodexWorkSection>
    </ActivityHostProvider>
  )
  const view = render(content(true))
  mounted.push(view)
  fireEvent.click(view.getByRole("button"))
  fireEvent.click(view.getByRole("button"))
  view.unmount()
  const restored = render(content(false))
  mounted.push(restored)
  expect(restored.getByRole("button")).toHaveAttribute("aria-expanded", "false")
})
