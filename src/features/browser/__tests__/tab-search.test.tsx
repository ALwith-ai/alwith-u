import "./language"
import { fireEvent, render, screen } from "@testing-library/react"
import { expect, test, vi } from "vitest"

import { matchTabs, TabSearch } from "../tab-search"

const tabs = [
  { id: "a", title: "Rust documentation", url: "https://doc.rust-lang.org/" },
  { id: "b", title: "Weather", url: "https://weather.example/today" }
]
const closed = [
  { title: "Old news", url: "https://news.example/old" },
  { title: "Rust forum", url: "https://users.rust-lang.org/" }
]

test("tabs are found by every word typed, in the title or the address, open ones first", () => {
  expect(matchTabs(tabs, closed, "").map((match) => match.title)).toEqual([
    "Rust documentation",
    "Weather",
    "Rust forum",
    "Old news"
  ])
  expect(matchTabs(tabs, closed, "rust").map((match) => match.title)).toEqual(["Rust documentation", "Rust forum"])
  expect(matchTabs(tabs, closed, "example today").map((match) => match.title)).toEqual(["Weather"])
  expect(matchTabs(tabs, closed, "rust weather")).toEqual([])
})

test("the tab found is shown, and a closed one is opened again", () => {
  const onSelect = vi.fn()
  const onReopen = vi.fn()
  const onOpenChange = vi.fn()
  render(
    <TabSearch open onOpenChange={onOpenChange} tabs={tabs} closed={closed} onSelect={onSelect} onReopen={onReopen} />
  )
  const input = screen.getByRole("textbox", { name: "搜索标签页" })
  fireEvent.change(input, { target: { value: "weather" } })
  fireEvent.keyDown(input, { key: "Enter" })
  expect(onSelect).toHaveBeenCalledWith("b")
  expect(onOpenChange).toHaveBeenLastCalledWith(false)
  fireEvent.change(input, { target: { value: "rust" } })
  fireEvent.keyDown(input, { key: "ArrowDown" })
  expect(screen.getByRole("option", { selected: true })).toHaveTextContent("Rust forum最近关闭")
  fireEvent.keyDown(input, { key: "Enter" })
  expect(onReopen).toHaveBeenCalledWith(1)
  fireEvent.change(input, { target: { value: "nothing here" } })
  expect(screen.getByText("没有找到标签页")).toBeInTheDocument()
})
