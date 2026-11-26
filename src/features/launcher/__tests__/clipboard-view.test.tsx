import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach, expect, test } from "vitest"

import type { Item_Serialize as ClipboardItem } from "@/bindings"
import { initI18n } from "@/lib/i18n"

import { ClipboardConsent, type ClipboardHost, ClipboardView } from "../clipboard-view"

await initI18n("en")
afterEach(cleanup)

function item(id: number, fields: Partial<ClipboardItem>): ClipboardItem {
  return { id, kind: "text", text: "", image: null, copiedAt: id, pinned: false, ...fields }
}

function mount(initial: ClipboardItem[]) {
  let items = initial
  let changed = () => {}
  const calls: string[] = []
  const announce = () => act(() => Promise.try(changed))
  const host: ClipboardHost = {
    list: (query, limit) => {
      calls.push(`list:${query}:${limit}`)
      return Promise.resolve(items.filter((listed) => listed.text.includes(query)))
    },
    thumbnail: (id) => Promise.resolve(`data:image/png;base64,${id}`),
    copy: (id) => Promise.resolve(calls.push(`copy:${id}`)),
    pin: (id, pinned) => {
      calls.push(`pin:${id}:${pinned}`)
      items = items.map((listed) => (listed.id === id ? { ...listed, pinned } : listed))
      return Promise.resolve()
    },
    remove: (id) => {
      calls.push(`remove:${id}`)
      items = items.filter((listed) => listed.id !== id)
      return Promise.resolve()
    },
    watch: (listener) => {
      changed = listener
      return Promise.resolve(() => {})
    }
  }
  const done: string[] = []
  const view = render(
    <ClipboardView
      host={host}
      onCopied={() => done.push("copied")}
      onLeave={() => done.push("leave")}
      onDismiss={() => done.push("dismiss")}
    />
  )
  const options = () => view.queryAllByRole("option").map((option) => option.textContent)
  return { view, calls, done, options, announce }
}

test("lists text by its first line, files by name and images by thumbnail, pinned entries first", async () => {
  const { view, options } = mount([
    item(3, { text: "\n  second line is the first with text\nthird" }),
    item(2, { kind: "files", text: "/tmp/a/report.pdf\n/tmp/notes.txt" }),
    item(1, { kind: "image", image: "/data/1.png", pinned: true })
  ])
  await waitFor(() =>
    expect(options()).toEqual(["Image", "second line is the first with text", "report.pdf, notes.txt"])
  )
  await waitFor(() =>
    expect(view.getByRole("option", { name: "Image" }).querySelector("img")?.getAttribute("src")).toBe(
      "data:image/png;base64,1"
    )
  )
  expect(view.getByText("Pinned")).toBeTruthy()
})

test("Enter puts the selected entry back on the clipboard and reports it", async () => {
  const { view, calls, done, options } = mount([item(2, { text: "newer" }), item(1, { text: "older" })])
  await waitFor(() => expect(options()).toEqual(["newer", "older"]))
  await act(() => Promise.try(() => fireEvent.keyDown(view.getByRole("combobox"), { key: "Enter" })))
  expect(calls).toContain("copy:2")
  expect(done).toEqual(["copied"])
})

test("typing searches the whole history and a change announcement reloads the list", async () => {
  const { view, calls, options, announce } = mount([item(2, { text: "build log" }), item(1, { text: "address" })])
  await waitFor(() => expect(options()).toEqual(["build log", "address"]))
  fireEvent.change(view.getByRole("combobox"), { target: { value: " log " } })
  await waitFor(() => expect(options()).toEqual(["build log"]))
  expect(calls).toContain("list:log:100")
  const before = calls.length
  await announce()
  await waitFor(() => expect(calls.length).toBeGreaterThan(before))
})

test("the shortcuts pin and remove the selected entry; Tab leaves and Escape dismisses", async () => {
  const { view, calls, done, options, announce } = mount([item(2, { text: "keep" }), item(1, { text: "drop" })])
  const input = view.getByRole("combobox")
  await waitFor(() => expect(options()).toEqual(["keep", "drop"]))
  fireEvent.keyDown(input, { key: "p", metaKey: true })
  expect(calls).toContain("pin:2:true")
  await announce()
  await waitFor(() => expect(view.getByText("Pinned")).toBeTruthy())
  fireEvent.keyDown(input, { key: "Backspace", ctrlKey: true })
  expect(calls).toContain("remove:2")
  await announce()
  await waitFor(() => expect(options()).toEqual(["drop"]))
  fireEvent.keyDown(input, { key: "Tab" })
  fireEvent.keyDown(input, { key: "Escape" })
  expect(done).toEqual(["leave", "dismiss"])
})

test("while the history is off, the view says what turning it on records and offers only that", () => {
  const done: string[] = []
  const view = render(
    <ClipboardConsent
      onEnable={() => done.push("enable")}
      onLeave={() => done.push("leave")}
      onDismiss={() => done.push("dismiss")}
    />
  )
  expect(view.getByText(/kept on this computer for three months/)).toBeTruthy()
  expect(view.getAllByRole("option").map((option) => option.textContent)).toEqual(["Turn on clipboard history"])
  fireEvent.keyDown(view.getByRole("combobox"), { key: "Enter" })
  expect(done).toEqual(["enable"])
})
