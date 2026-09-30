import { afterEach, describe, expect, mock, test } from "bun:test"
import type { MessageItem } from "@alwith/api"
import { act, cleanup, fireEvent, render } from "@testing-library/react"
import type { Turn } from "../../turns"
import type { NavigationRailItem } from "../navigation-rail"
import { navigationSoundStore } from "../navigation-sound-store"
import { installDom } from "./dom-environment"

installDom()
mock.module("@tauri-apps/plugin-log", () => ({ info: async () => {} }))
const { ThreadUserMessageNavigationRail, toNavigationRailItems } = await import("../navigation-rail")
// happy-dom has no AudioContext; with sounds off the rail never touches one.
navigationSoundStore.setState({ soundMode: "none" })

afterEach(() => {
  cleanup()
  document.body.innerHTML = ""
})

function items(count: number): NavigationRailItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `user-${index}`,
    turnKey: `turn:user:user-${index}`,
    label: `question ${index}`,
    response: `answer ${index}`
  }))
}

function message(id: string, kind: MessageItem["kind"], text: string): MessageItem {
  return { id, kind, content: [{ type: "text", text }], _meta: null, at: 0, replayed: false } as MessageItem
}

function turn(index: number, final: string | null): Turn {
  const user = message(`user-${index}`, "user", `question ${index}`)
  const finals = final === null ? [] : [message(`assistant-${index}`, "assistant", final)]
  return {
    key: `turn:user:user-${index}`,
    user,
    work: [],
    final: finals,
    edits: [],
    startedAt: 0,
    endedAt: 0,
    replayed: false,
    items: [user, ...finals]
  }
}

describe("navigation rail", () => {
  test("items come from user turns; the preview is the first paragraph of the answer", () => {
    const rail = toNavigationRailItems([turn(0, "first paragraph\n\nsecond"), turn(1, null)], {
      "user-0": { totalTokens: 30, inputTokens: 20, outputTokens: 10 }
    })
    expect(rail).toEqual([
      {
        id: "user-0",
        turnKey: "turn:user:user-0",
        label: "question 0",
        response: "first paragraph",
        inputTokens: 20,
        outputTokens: 10
      },
      { id: "user-1", turnKey: "turn:user:user-1", label: "question 1", response: "", inputTokens: 0, outputTokens: 0 }
    ])
  })

  test("fewer than four messages render no rail", () => {
    const root = document.createElement("div")
    const { container } = render(
      <ThreadUserMessageNavigationRail
        items={items(3)}
        scrollRoot={root}
        beforeReveal={() => {}}
        ensureItemMounted={async () => {}}
      />
    )
    expect(container.querySelector("nav")).toBeNull()
  })

  test("clicking a marker releases following and reveals the turn through the virtualizer", async () => {
    const root = document.createElement("div")
    const revealed: string[] = []
    let released = 0
    const { container } = render(
      <ThreadUserMessageNavigationRail
        items={items(5)}
        scrollRoot={root}
        beforeReveal={() => {
          released += 1
        }}
        ensureItemMounted={async item => {
          revealed.push(item.turnKey)
        }}
      />
    )
    const rows = container.querySelectorAll("[data-thread-user-message-navigation-item-id]")
    expect(rows.length).toBe(5)
    await act(async () => {
      fireEvent.click(rows[2])
    })
    expect(released).toBe(1)
    expect(revealed).toEqual(["turn:user:user-2"])
    expect(rows[4].getAttribute("aria-current")).toBe("true")
  })
})
