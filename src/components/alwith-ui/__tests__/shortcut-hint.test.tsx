import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

import { displayShortcut } from "@/lib/shortcut-formatter"

import { Button } from "../button"

afterEach(cleanup)

test("shortcut buttons expose a separate keycap on focus, update it, and preserve activation", async () => {
  const activate = vi.fn()
  const view = render(
    <Button title="Open floating chat" shortcut="Alt+Space" onClick={activate}>
      Open
    </Button>
  )
  const button = screen.getByRole("button", { name: "Open" })
  expect(button).not.toHaveAttribute("title")
  await act(() => Promise.try(() => button.focus()))
  const hint = await screen.findByRole("tooltip")
  expect(hint).toHaveTextContent("Open floating chat")
  expect(hint.querySelector("kbd")).toHaveTextContent(displayShortcut("Alt+Space"))
  view.rerender(
    <Button title="Open floating chat" shortcut="CmdOrCtrl+Shift+P" onClick={activate}>
      Open
    </Button>
  )
  expect(hint.querySelector("kbd")).toHaveTextContent(displayShortcut("CmdOrCtrl+Shift+P"))
  view.rerender(
    <Button title="Open floating chat" shortcut="" onClick={activate}>
      Open
    </Button>
  )
  expect(hint.querySelector("kbd")).toBeNull()
  expect(hint).toHaveTextContent("Open floating chat")
  fireEvent.click(button)
  expect(activate).toHaveBeenCalledTimes(1)
})
