import { fireEvent, render } from "@testing-library/react"
import { afterEach, describe, expect, mock, test } from "bun:test"
import { installDom } from "@/features/chat/codex/__tests__/dom-environment"
import { NavigationGroup } from "../navigation-group"

installDom()

afterEach(() => {
  document.body.innerHTML = ""
})

describe("NavigationGroup", () => {
  test("使用导航自有折叠交互且不渲染箭头槽", () => {
    const onOpenChange = mock(() => {})
    const screen = render(
      <NavigationGroup open={false} onOpenChange={onOpenChange} label="Project" active>
        <div>Session</div>
      </NavigationGroup>
    )

    expect(screen.getAllByRole("button", { name: "Project" })).toHaveLength(1)
    expect(screen.queryByText("Session")).toBeNull()
    const trigger = screen.getByRole("button", { name: "Project" })
    const row = trigger.parentElement!
    for (const cls of [
      "h-[var(--navigation-row-height)]",
      "rounded-[10px]",
      "ps-1",
      "pe-1.5",
      "gap-1",
      "hover:bg-foreground/8",
      "data-active:bg-foreground/5"
    ])
      expect(row.classList.contains(cls)).toBe(true)
    expect(row.getAttribute("data-active")).toBe("")
    expect(trigger.querySelector("svg")).toBeNull()
    expect(row.parentElement!.classList.contains("text-[#1a1c1f]")).toBe(true)
    expect(screen.getByText("Project").parentElement!.classList.contains("opacity-70")).toBe(true)

    fireEvent.click(screen.getByText("Project"))
    expect(onOpenChange).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(true)
  })

  test("展开内容统一使用导航纵向栈并保留所有 2px 间隙", () => {
    const screen = render(
      <NavigationGroup open onOpenChange={() => {}} label="Project">
        <div>Session</div>
        <div>Another session</div>
      </NavigationGroup>
    )

    expect(screen.getAllByText("Session")).toHaveLength(1)
    expect(screen.getAllByText("Another session")).toHaveLength(1)
    const stack = screen.getByText("Session").parentElement!
    expect(stack.classList.contains("mt-0.5")).toBe(true)
    expect(stack.classList.contains("gap-0.5")).toBe(true)
  })
})
