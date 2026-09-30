import { afterEach, describe, expect, test } from "bun:test"
import {
  VirtualizedTurnList,
  type VirtualizedTurnListApi,
  type VirtualizedTurnListEntry
} from "@alwith/module-chat/virtualized-turn-list"
import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { createRef } from "react"
import { installDom } from "./dom-environment"

installDom()

function entries(count: number): VirtualizedTurnListEntry[] {
  return Array.from({ length: count }, (_, index) => ({ turnKey: `turn-${index}` }))
}

// A ResizeObserver the test can fire by hand: the compensation path needs the anchor turn to
// carry a measured height, and the DOM's no-op stub never delivers one.
class ControlledResizeObserver implements ResizeObserver {
  static readonly instances: ControlledResizeObserver[] = []
  readonly targets = new Set<Element>()
  private readonly callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    ControlledResizeObserver.instances.push(this)
  }
  observe(target: Element): void {
    this.targets.add(target)
  }
  unobserve(target: Element): void {
    this.targets.delete(target)
  }
  disconnect(): void {
    this.targets.clear()
  }
  measure(target: Element, blockSize: number): void {
    this.callback([{ target, borderBoxSize: [{ blockSize, inlineSize: 0 }] } as unknown as ResizeObserverEntry], this)
  }
}

function findTurnObserver(): ControlledResizeObserver {
  const turnObserver = ControlledResizeObserver.instances.find(instance =>
    [...instance.targets].some(target => target instanceof HTMLElement && target.dataset.turnKey !== undefined)
  )
  if (turnObserver === undefined) throw new Error("Codex turn resize observer is missing")
  return turnObserver
}

const nativeResizeObserver = globalThis.ResizeObserver
function stubResizeObserver(): void {
  ControlledResizeObserver.instances.length = 0
  globalThis.ResizeObserver = ControlledResizeObserver as unknown as typeof ResizeObserver
}

function countByTestId(root: Element, testId: string): number {
  return root.querySelectorAll(`[data-testid="${testId}"]`).length
}

function scrollElementWithHeight(
  scrollHeight: number | (() => number),
  onScrollTo?: (top: number) => void
): HTMLDivElement {
  const scrollElement = document.createElement("div")
  let scrollTop = 0
  Object.defineProperties(scrollElement, {
    clientHeight: { configurable: true, value: 800 },
    scrollHeight:
      typeof scrollHeight === "number"
        ? { configurable: true, value: scrollHeight }
        : { configurable: true, get: scrollHeight },
    scrollTop: {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value
      }
    },
    scrollTo: {
      configurable: true,
      value: ({ top }: ScrollToOptions) => {
        if (top === undefined) throw new Error("Codex test scroll target is missing")
        scrollTop = top
        onScrollTo?.(top)
      }
    }
  })
  document.body.append(scrollElement)
  return scrollElement
}

function threadHeight(scrollElement: HTMLElement): number {
  const thread = scrollElement.querySelector<HTMLElement>("[data-codex-thread]")
  if (thread === null) throw new Error("Codex thread element is missing")
  return Number.parseFloat(thread.style.height)
}

describe("VirtualizedTurnList", () => {
  afterEach(() => {
    cleanup()
    globalThis.ResizeObserver = nativeResizeObserver
    document.body.replaceChildren()
  })

  test("mounts only the real bottom-coordinate window for an 80-turn chat", () => {
    const scrollElement = scrollElementWithHeight(80 * 280 + 79 * 12)

    render(
      <VirtualizedTurnList
        entries={entries(80)}
        renderTurn={entry => <div data-testid={entry.turnKey}>{entry.turnKey}</div>}
        scrollElement={scrollElement}
        sessionKey="test-session"
      />,
      { container: scrollElement }
    )

    expect(countByTestId(scrollElement, "turn-79")).toBe(1)
    expect(countByTestId(scrollElement, "turn-0")).toBe(0)
    expect(scrollElement.querySelectorAll("[data-turn-key]")).toHaveLength(5)
    expect(scrollElement.querySelector("[data-codex-thread]")?.getAttribute("data-codex-virtualized-turn-count")).toBe(
      "5"
    )

    scrollElement.scrollTop = 0
    fireEvent.scroll(scrollElement)

    expect(countByTestId(scrollElement, "turn-0")).toBe(1)
    // The latest turn stays mounted (streaming growth must not be frozen by virtualization);
    // every other turn outside the window unmounts.
    expect(countByTestId(scrollElement, "turn-79")).toBe(1)
    expect(countByTestId(scrollElement, "turn-78")).toBe(0)
  })

  test("renders the bottom virtual window immediately when replay grows from zero to 80 turns", () => {
    const scrollElement = scrollElementWithHeight(80 * 280 + 79 * 12)

    const view = render(
      <VirtualizedTurnList
        entries={[]}
        renderTurn={entry => <div data-testid={entry.turnKey}>{entry.turnKey}</div>}
        scrollElement={scrollElement}
        sessionKey="replayed-session"
      />,
      { container: scrollElement }
    )

    view.rerender(
      <VirtualizedTurnList
        entries={entries(80)}
        renderTurn={entry => <div data-testid={entry.turnKey}>{entry.turnKey}</div>}
        scrollElement={scrollElement}
        sessionKey="replayed-session"
      />
    )

    expect(countByTestId(scrollElement, "turn-79")).toBe(1)
    expect(countByTestId(scrollElement, "turn-0")).toBe(0)
    expect(scrollElement.querySelectorAll("[data-turn-key]")).toHaveLength(5)
  })

  test("restores a remounted session without sharing its position with another session", () => {
    const totalHeight = 80 * 280 + 79 * 12
    const mount = (sessionKey: string) => {
      const scrollElement = scrollElementWithHeight(totalHeight)
      const view = render(
        <VirtualizedTurnList
          entries={entries(80)}
          renderTurn={entry => <div data-testid={entry.turnKey}>{entry.turnKey}</div>}
          scrollElement={scrollElement}
          sessionKey={sessionKey}
        />,
        { container: scrollElement }
      )
      return { scrollElement, view }
    }

    const first = mount("restore-isolation-a")
    first.scrollElement.scrollTop = 10_000
    fireEvent.scroll(first.scrollElement)
    expect(countByTestId(first.scrollElement, "turn-34")).toBe(1)
    first.view.unmount()

    // Identical turn keys in another session must not restore the first session's viewport.
    const second = mount("restore-isolation-b")
    expect(second.scrollElement.scrollTop).toBe(totalHeight - 800)
    expect(countByTestId(second.scrollElement, "turn-34")).toBe(0)
    second.scrollElement.scrollTop = 2_000
    fireEvent.scroll(second.scrollElement)
    second.view.unmount()

    const restoredFirst = mount("restore-isolation-a")
    expect(restoredFirst.scrollElement.scrollTop).toBe(10_000)
    expect(countByTestId(restoredFirst.scrollElement, "turn-34")).toBe(1)
    restoredFirst.view.unmount()

    const restoredSecond = mount("restore-isolation-b")
    expect(restoredSecond.scrollElement.scrollTop).toBe(2_000)
    expect(countByTestId(restoredSecond.scrollElement, "turn-6")).toBe(1)
    restoredSecond.view.unmount()
  })

  test("excludes trailing spacers from the virtual scroll coordinate system", () => {
    const virtualHeight = 80 * 280 + 79 * 12
    const composerHeight = 160
    const scrollElement = scrollElementWithHeight(virtualHeight + composerHeight)
    scrollElement.scrollTop = virtualHeight + composerHeight - 800

    render(
      <VirtualizedTurnList
        entries={entries(80)}
        renderTurn={entry => <div data-testid={entry.turnKey}>{entry.turnKey}</div>}
        scrollElement={scrollElement}
        sessionKey="composer-spacer-session"
      />,
      { container: scrollElement }
    )

    expect(countByTestId(scrollElement, "turn-79")).toBe(1)
    expect(scrollElement.querySelector("[data-codex-thread]")?.getAttribute("data-codex-virtualized-total-count")).toBe(
      "80"
    )

    scrollElement.scrollTop = 0
    fireEvent.scroll(scrollElement)

    expect(countByTestId(scrollElement, "turn-0")).toBe(1)
    expect(countByTestId(scrollElement, "turn-79")).toBe(1)
    expect(countByTestId(scrollElement, "turn-78")).toBe(0)
  })

  test("keeps scrollTop fixed when a mid-history turn grows from a disclosure expand", () => {
    stubResizeObserver()
    const composerHeight = 160
    const scrollElement = scrollElementWithHeight(() => threadHeight(scrollElement) + composerHeight)

    render(
      <VirtualizedTurnList
        entries={entries(80)}
        renderTurn={entry => <div data-testid={entry.turnKey}>{entry.turnKey}</div>}
        scrollElement={scrollElement}
        sessionKey="disclosure-expand-session"
      />,
      { container: scrollElement }
    )

    scrollElement.scrollTop = 10_000
    fireEvent.scroll(scrollElement)

    const turnObserver = findTurnObserver()
    const turnElements = [...turnObserver.targets].filter(
      (target): target is HTMLElement => target instanceof HTMLElement && target.dataset.turnKey !== undefined
    )

    // Every visible turn measures at the estimate: geometry unchanged, scrollTop must not move.
    act(() => {
      for (const target of turnElements) turnObserver.measure(target, 280)
    })
    expect(scrollElement.scrollTop).toBe(10_000)

    // The anchor turn at the viewport top grows by 240: compensation keeps scrollTop in place.
    const anchorTurn = turnElements.find(target => target.dataset.turnKey === "turn-34")
    if (anchorTurn === undefined) throw new Error("Codex anchor turn is missing")
    act(() => {
      turnObserver.measure(anchorTurn, 520)
    })
    expect(scrollElement.scrollTop).toBe(10_000)

    // Collapsing back is symmetric.
    act(() => {
      turnObserver.measure(anchorTurn, 280)
    })
    expect(scrollElement.scrollTop).toBe(10_000)
  })

  test("skips anchor compensation when the viewport is already pinned at the live bottom", () => {
    // The pin wrote scrollTop to the bottom but its scroll event has not fired yet, so the
    // remembered distance is stale: a layout change must not drag the viewport back up.
    stubResizeObserver()
    const composerHeight = 160
    const scrollElement = scrollElementWithHeight(() => threadHeight(scrollElement) + composerHeight)

    render(
      <VirtualizedTurnList
        entries={entries(80)}
        renderTurn={entry => <div data-testid={entry.turnKey}>{entry.turnKey}</div>}
        scrollElement={scrollElement}
        sessionKey="pinned-bottom-session"
      />,
      { container: scrollElement }
    )

    scrollElement.scrollTop = 10_000
    fireEvent.scroll(scrollElement)
    const turnObserver = findTurnObserver()
    act(() => {
      for (const target of turnObserver.targets) {
        if (target instanceof HTMLElement && target.dataset.turnKey !== undefined) turnObserver.measure(target, 280)
      }
    })
    expect(scrollElement.scrollTop).toBe(10_000)

    scrollElement.scrollTop = scrollElement.scrollHeight - 800
    const pinnedScrollTop = scrollElement.scrollTop

    // The resident latest turn grows by 240 while the live geometry is within 96px of the
    // bottom: compensation is skipped and the viewport stays put.
    const latestTurn = [...turnObserver.targets].find(
      (target): target is HTMLElement => target instanceof HTMLElement && target.dataset.turnKey === "turn-79"
    )
    if (latestTurn === undefined) throw new Error("Codex latest turn is missing")
    act(() => {
      turnObserver.measure(latestTurn, 520)
    })
    expect(scrollElement.scrollTop).toBe(pinnedScrollTop)
  })

  test("positions an unmounted unequal-height user message at the Codex 10px top inset", async () => {
    const scrollTargets: number[] = []
    const scrollElement = scrollElementWithHeight(
      () => {
        const thread = scrollElement.querySelector<HTMLElement>("[data-codex-thread]")
        if (thread === null) return 80 * 280 + 79 * 12 + 409
        return Number.parseFloat(thread.style.height) + 409
      },
      top => scrollTargets.push(top)
    )
    const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")
    const bounds = HTMLElement.prototype.getBoundingClientRect
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get(this: HTMLElement) {
        return this.dataset.turnKey === "turn-40" ? 600 : 280
      }
    })
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      const top = this.dataset.navigationTarget === "" ? 80 : 0
      const height = this.dataset.navigationTarget === "" ? 40 : this.dataset.turnKey === "turn-40" ? 600 : 280
      return { bottom: top + height, height, left: 0, right: 0, top, width: 100, x: 0, y: top, toJSON() {} }
    }
    try {
      const ref = createRef<VirtualizedTurnListApi>()
      render(
        <VirtualizedTurnList
          ref={ref}
          entries={entries(80)}
          renderTurn={entry => (
            <div>
              {entry.turnKey}
              <div data-navigation-target="" />
            </div>
          )}
          scrollElement={scrollElement}
          sessionKey="unequal-navigation-session"
        />,
        { container: scrollElement }
      )

      let navigation!: Promise<void>
      act(() => {
        const api = ref.current
        if (api === null) throw new Error("Codex virtualized list API is missing")
        navigation = api.scrollToKey("turn-40", turn => turn.querySelector<HTMLElement>("[data-navigation-target]"), {
          align: "top"
        })
      })
      await act(async () => navigation)

      expect(scrollTargets.at(-1)).toBe(11_750)
      expect(scrollElement.textContent).toContain("turn-40")
    } finally {
      if (offsetHeight !== undefined) Object.defineProperty(HTMLElement.prototype, "offsetHeight", offsetHeight)
      HTMLElement.prototype.getBoundingClientRect = bounds
    }
  })
})
