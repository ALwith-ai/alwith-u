import { fireEvent, render, screen } from "@testing-library/react"
import { expect, test, vi } from "vitest"

import catalog from "@/locales/zh-CN.json"

import { menuEntries, PageContextMenu, type PageMenu, type PageMenuItem, type Words } from "../page-menu"

// The catalog the application ships, so a missing or misnamed key fails here.
const words: Words = (key, values = {}) => {
  const text = (catalog.pageMenu as Record<string, string>)[key]
  if (text === undefined) throw new Error(`No pageMenu.${key}`)
  return text.replaceAll(/{{(\w+)}}/g, (_, name: string) => values[name]!)
}
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) => words(key.replace("pageMenu.", ""), values)
  })
}))

const entry = (command: number, label: string, more: Partial<PageMenuItem> = {}): PageMenuItem => ({
  command,
  label,
  kind: "command",
  enabled: true,
  checked: false,
  items: [],
  ...more
})
const separator = entry(-1, "", { kind: "separator" })
const menu = (more: Partial<PageMenu>): PageMenu => ({
  id: 1,
  x: 120,
  y: 60,
  linkUrl: "",
  imageUrl: "",
  selectionText: "",
  editable: false,
  items: [],
  ...more
})
/** What a menu offers before its last entry, which every menu has: see the test of it below. */
const labels = (value: PageMenu) =>
  menuEntries(value, words)
    .slice(0, -2)
    .map((item) => (item.kind === "separator" ? "-" : item.label))

test("every menu ends by offering the element under the pointer to the developer tools", () => {
  const entries = menuEntries(menu({ items: [entry(113, "Copy")] }), words)
  expect(entries.map((item) => (item.kind === "separator" ? "-" : item.label))).toEqual(["复制", "-", "检查"])
  expect(entries.at(-1)).toMatchObject({ enabled: true, action: { inspect: true } })
  // Nothing else to offer is no menu at all.
  expect(menuEntries(menu({ items: [] }), words)).toEqual([])
})

test("a page's menu goes back, forward and reloads, prints and shows the source", () => {
  const page = menu({
    items: [
      entry(100, "Back", { enabled: false }),
      entry(101, "Forward"),
      separator,
      entry(131, "Print..."),
      entry(132, "View page source")
    ]
  })
  expect(labels(page)).toEqual(["返回", "前进", "重新加载", "-", "打印…", "查看网页源代码"])
  expect(menuEntries(page, words)[0]).toMatchObject({ enabled: false, action: { command: 100 } })
  expect(menuEntries(page, words)[2]).toMatchObject({ action: { reload: true } })
  // The source is shown in a tab of the user's, not by the browser's own command.
  expect(menuEntries(page, words)[4]).toMatchObject({ action: { command: 131 } })
  expect(menuEntries(page, words)[5]).toMatchObject({ action: { source: true } })
})

test("a link, an image and a selection each bring what the application does with them", () => {
  expect(
    labels(
      menu({
        linkUrl: "https://a.example/next",
        imageUrl: "https://a.example/cat.png",
        selectionText: "  needle in a haystack that goes on and on  ",
        items: [entry(113, "Copy")]
      })
    )
  ).toEqual([
    "在新标签页中打开链接",
    "复制链接地址",
    "下载链接",
    "-",
    "在新标签页中打开图片",
    "复制图片地址",
    "保存图片",
    "-",
    "搜索“needle in a haystack tha…”",
    "-",
    "复制"
  ])
  const [open, copy, save] = menuEntries(menu({ linkUrl: "https://a.example/next" }), words)
  expect(save).toMatchObject({ action: { save: "https://a.example/next" } })
  // An address the browser cannot fetch again, such as an image held in the page, is not offered for saving.
  expect(labels(menu({ imageUrl: "data:image/png;base64,AAAA" }))).toEqual(["在新标签页中打开图片", "复制图片地址"])
  expect(open).toMatchObject({ action: { open: "https://a.example/next" } })
  expect(copy).toMatchObject({ action: { copy: "https://a.example/next" } })
  // Text being edited is not searched for; its menu is the editing commands.
  expect(
    labels(
      menu({
        editable: true,
        selectionText: "word",
        items: [entry(112, "Cut"), entry(113, "Copy"), entry(114, "Paste")]
      })
    )
  ).toEqual(["剪切", "复制", "粘贴"])
})

test("an extension's entries keep their titles, their submenus and their checks", () => {
  const entries = menuEntries(
    menu({
      items: [
        entry(113, "Copy"),
        separator,
        entry(49000, "Translator", {
          kind: "submenu",
          items: [
            entry(49001, "Translate selection"),
            separator,
            entry(49002, "Always translate", { kind: "check", checked: true })
          ]
        })
      ]
    }),
    words
  )
  expect(entries[2]).toMatchObject({
    kind: "submenu",
    label: "Translator",
    items: [
      { label: "Translate selection", action: { command: 49001 } },
      { kind: "separator" },
      { label: "Always translate", checked: true, action: { command: 49002 } }
    ]
  })
})

test("the menu opens where it was asked for, runs what is chosen and is dismissed when left", async () => {
  const onChoose = vi.fn()
  const onDismiss = vi.fn()
  const page = menu({
    linkUrl: "https://a.example/next",
    items: [entry(100, "Back"), entry(101, "Forward", { enabled: false })]
  })
  const view = render(<PageContextMenu menu={page} scale={2} onChoose={onChoose} onDismiss={onDismiss} />)
  // The browser's points are half the interface's at twice the zoom.
  const anchor = view.baseElement.querySelector<HTMLElement>("[data-slot=dropdown-menu-trigger]")!
  expect([anchor.style.left, anchor.style.top]).toEqual(["60px", "30px"])
  expect(screen.getByRole("menuitem", { name: "前进" })).toHaveAttribute("aria-disabled", "true")
  fireEvent.click(screen.getByRole("menuitem", { name: "复制链接地址" }))
  expect(onChoose).toHaveBeenCalledExactlyOnceWith({ copy: "https://a.example/next" })
  expect(onDismiss).not.toHaveBeenCalled()
})

test("a menu with nothing to offer is dismissed at once", () => {
  const onDismiss = vi.fn()
  render(
    <PageContextMenu
      menu={menu({ items: [entry(130, "Find...")] })}
      scale={1}
      onChoose={vi.fn()}
      onDismiss={onDismiss}
    />
  )
  expect(onDismiss).toHaveBeenCalledOnce()
  expect(screen.queryByRole("menu")).toBeNull()
})

test("a page that can be pointed at opens its menu by offering to say something about the spot", () => {
  const entries = menuEntries(menu({ items: [entry(113, "Copy")] }), words, true)
  expect(entries.map((item) => (item.kind === "separator" ? "-" : item.label))).toEqual([
    "对这里说…",
    "-",
    "复制",
    "-",
    "检查"
  ])
  expect(entries[0]).toMatchObject({ enabled: true, action: { say: true } })
  // With nothing else to offer, that is the whole menu.
  expect(menuEntries(menu({ items: [] }), words, true)).toEqual([
    { kind: "item", label: "对这里说…", enabled: true, action: { say: true } }
  ])
})
