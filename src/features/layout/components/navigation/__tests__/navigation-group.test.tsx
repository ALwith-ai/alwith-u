import { afterEach, describe, expect, mock, test } from "bun:test"
import { cleanup, fireEvent, render } from "@testing-library/react"
import { installDom } from "@/features/chat/codex/__tests__/dom-environment"
import { must } from "@/lib/__tests__/must"
import { NavigationGroup } from "../navigation-group"

installDom()

afterEach(() => {
  cleanup()
  document.body.innerHTML = ""
})

describe("NavigationGroup", () => {
  test("uses the navigation's own collapse interaction and renders no chevron slot", () => {
    const onOpenChange = mock(() => {})
    const screen = render(
      <NavigationGroup open={false} onOpenChange={onOpenChange} label="Project" active>
        <div>Session</div>
      </NavigationGroup>
    )

    expect(screen.getAllByRole("button", { name: "Project" })).toHaveLength(1)
    expect(screen.queryByText("Session")).toBeNull()
    const trigger = screen.getByRole("button", { name: "Project" })
    const row = must(trigger.parentElement, "the trigger row")
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
    expect(must(row.parentElement, "the group").classList.contains("text-[#1a1c1f]")).toBe(true)
    expect(must(screen.getByText("Project").parentElement, "the project row").classList.contains("opacity-70")).toBe(
      true
    )

    fireEvent.click(screen.getByText("Project"))
    expect(onOpenChange).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(true)
  })

  test("renders expanded content in the navigation's vertical stack and keeps every 2px gap", () => {
    const screen = render(
      <NavigationGroup open onOpenChange={() => {}} label="Project">
        <div>Session</div>
        <div>Another session</div>
      </NavigationGroup>
    )

    expect(screen.getAllByText("Session")).toHaveLength(1)
    expect(screen.getAllByText("Another session")).toHaveLength(1)
    const stack = must(screen.getByText("Session").parentElement, "the session stack")
    expect(stack.classList.contains("mt-0.5")).toBe(true)
    expect(stack.classList.contains("gap-0.5")).toBe(true)
  })
})
