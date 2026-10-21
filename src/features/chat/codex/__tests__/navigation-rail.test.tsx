import type { MessageItem } from "@alwith/api"
import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, describe, expect, test, vi } from "vitest"

import type { HistoryNavigationState } from "@/agent/history-navigation"

import { historyTimeline } from "../../history-timeline"
import type { Turn } from "../../turns"
import type { NavigationRailItem } from "../navigation-rail"
import { navigationSoundStore } from "../navigation-sound-store"

vi.mock("@tauri-apps/plugin-log", () => ({ info: async () => {} }))
vi.mock("@/components/theme-provider", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }))
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
    response: `answer ${index}`,
    inputTokens: 0,
    outputTokens: 0
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
  test("the full index supplies unloaded targets and preview hydration does not add transcript turns", () => {
    const latest = turn(2, "latest")
    if (latest.user === null) throw new Error("Expected user turn")
    latest.user._meta = { codex: { turnId: "native-2" } }
    const navigation: HistoryNavigationState = {
      turns: [{ turnId: "native-0" }, { turnId: "native-1" }, { turnId: "native-2" }],
      loadedTurnIds: ["native-2"],
      loading: false,
      complete: true,
      error: null,
      turnErrors: {},
      previews: {
        "native-0": { state: "loaded", messages: [{ id: "old-user", label: "old", response: "**answer**" }] }
      }
    }
    const rail = toNavigationRailItems([latest], {}, navigation)
    expect(rail).toHaveLength(3)
    expect(rail[0]).toMatchObject({ label: "old", response: "**answer**", isLoaded: false, messageId: "old-user" })
    expect(rail[1]).toMatchObject({ previewState: "loading", isLoaded: false })
    expect(rail[2].id).toBe("user-2")
    const timeline = historyTimeline([latest], navigation)
    expect(timeline.map((entry) => entry.turnKey)).toEqual(["history:native-0", "history:native-1", "history:native-2"])
    expect(timeline[2].aliases).toEqual([latest.key])
    expect(timeline.filter((entry) => entry.turn !== undefined)).toHaveLength(1)
  })
  test("items come from user turns; the preview retains Markdown and the full final answer", () => {
    const rail = toNavigationRailItems([turn(0, "first paragraph\n\nsecond"), turn(1, null)], {
      "user-0": { totalTokens: 30, inputTokens: 20, outputTokens: 10 }
    })
    expect(rail).toEqual([
      {
        id: "user-0",
        turnKey: "turn:user:user-0",
        label: "question 0",
        response: "first paragraph\n\nsecond",
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
        ensureItemMounted={(item) => {
          return Promise.try(() => {
            revealed.push(item.turnKey)
          })
        }}
      />
    )
    const rows = container.querySelectorAll("[data-thread-user-message-navigation-item-id]")
    expect(rows.length).toBe(5)
    await act(() => {
      return Promise.try(() => {
        fireEvent.click(rows[2])
      })
    })
    expect(released).toBe(1)
    expect(revealed).toEqual(["turn:user:user-2"])
    expect(rows[4].getAttribute("aria-current")).toBe("true")
  })
})
