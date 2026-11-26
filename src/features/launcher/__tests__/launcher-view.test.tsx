import { cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach, expect, test } from "vitest"

import { initI18n } from "@/lib/i18n"

import { LauncherView } from "../launcher-view"
import { type Entry, index } from "../lib/order"
import { visited } from "../lib/usage"

await initI18n("en")
afterEach(cleanup)

function entry(title: string, fields: Partial<Entry> = {}): Entry {
  return { id: title, kind: "application", title, alternates: [], subtitle: "", alias: "", ...fields }
}

const catalog = [
  entry("Safari"),
  entry("微信"),
  entry("Fix the login page", { kind: "session", subtitle: "website" })
].map(index)

function mount(usage = {}) {
  const opened: [string, string][] = []
  const sent: string[] = []
  let dismissed = 0
  const view = render(
    <LauncherView
      catalog={catalog}
      icon={(listed) => Promise.resolve(listed.id === "Safari" ? "data:image/png;base64,AAAA" : null)}
      usage={usage}
      onOpen={(opening, query) => opened.push([opening.id, query])}
      onSend={(text) => sent.push(text)}
      onDismiss={() => {
        dismissed += 1
      }}
    />
  )
  const options = () => view.getAllByRole("option").map((option) => option.textContent)
  return { view, opened, sent, dismissed: () => dismissed, options }
}

test("an empty query lists what is used first and offers no new chat", () => {
  const { options } = mount(visited({}, "微信", "", Date.now()))
  expect(options()).toEqual(["微信Application", "SafariApplication", "Fix the login pagewebsite"])
})

test("typing narrows the list by name or pinyin and Enter opens the first result with its query", () => {
  const { view, opened, options } = mount()
  const input = view.getByRole("combobox")
  fireEvent.change(input, { target: { value: "WX" } })
  expect(options()).toEqual(["微信Application", "New chat"])
  fireEvent.keyDown(input, { key: "Enter" })
  expect(opened).toEqual([["微信", "wx"]])
})

test("an application shows its icon once it has loaded and other entries the glyph of their kind", async () => {
  const { view } = mount()
  await waitFor(() =>
    expect(
      view
        .getByRole("option", { name: /Safari/ })
        .querySelector("img")
        ?.getAttribute("src")
    ).toBe("data:image/png;base64,AAAA")
  )
  expect(view.getByRole("option", { name: /Fix the login page/ }).querySelector("svg")).not.toBeNull()
})

test("a query nothing matches leaves the new chat row, which sends the text as typed", () => {
  const { view, sent, opened, options } = mount()
  const input = view.getByRole("combobox")
  fireEvent.change(input, { target: { value: "  Why is the build Red? " } })
  expect(options()).toEqual(["New chat"])
  fireEvent.keyDown(input, { key: "Enter" })
  expect(sent).toEqual(["Why is the build Red?"])
  expect(opened).toEqual([])
})

test("Escape dismisses, except while an input method is composing", () => {
  const { view, dismissed } = mount()
  const input = view.getByRole("combobox")
  fireEvent.keyDown(input, { key: "Escape", isComposing: true })
  expect(dismissed()).toBe(0)
  fireEvent.keyDown(input, { key: "Escape" })
  expect(dismissed()).toBe(1)
})

test("Tab moves to the clipboard history only where there is one", () => {
  let moved = 0
  const view = render(
    <LauncherView
      catalog={catalog}
      icon={() => Promise.resolve(null)}
      usage={{}}
      onOpen={() => {}}
      onSend={() => {}}
      onClipboard={() => {
        moved += 1
      }}
      onDismiss={() => {}}
    />
  )
  expect(fireEvent.keyDown(view.getByRole("combobox"), { key: "Tab" })).toBe(false)
  expect(moved).toBe(1)
  cleanup()
  // Without a clipboard history Tab keeps its own meaning.
  expect(fireEvent.keyDown(mount().view.getByRole("combobox"), { key: "Tab" })).toBe(true)
})
