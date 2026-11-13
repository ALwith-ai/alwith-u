import { createEditorController } from "@alwith/module-editor"
import { Plus } from "lucide-react"

import { Button as SidebarButton } from "../../../src/components/alwith-ui/button"
import "@alwith/module-editor/styles.css"
import { createFileTabs } from "@alwith/module-editor/tabs/core"
import { createFileSystem } from "@alwith/module-fs"
import { createMemoryAdapter } from "@alwith/module-fs/testing"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { type ReactNode, useEffect, useState } from "react"
import { expect, waitFor } from "storybook/test"

import { FileTabs } from "../../../src/features/workspace/file-tabs"
import { PreviewSurface } from "../../../src/features/workspace/preview-surface"
import "../../../src/features/workspace/workspace.css"
import { initI18n } from "../../../src/lib/i18n"

function filePath(index: number, longNames: boolean): string {
  return `/${index}${longNames && index < 2 ? "-long-file-name".repeat(8) : ""}.txt`
}

function TabsExample({
  direction = "ltr",
  count = 3,
  controls = false,
  longNames = false
}: {
  direction?: "ltr" | "rtl"
  count?: number
  controls?: boolean
  longNames?: boolean
}) {
  const [treeVisible, setTreeVisible] = useState(false)
  const [state] = useState(() => {
    const reportError = (error: unknown): never => {
      throw error
    }
    const fs = createFileSystem({
      adapter: createMemoryAdapter(
        Object.fromEntries(Array.from({ length: count }, (_, index) => [filePath(index, longNames), `${index}`]))
      ),
      reportError
    })
    const editor = createEditorController({ fs, reportError, confirmClose: () => Promise.resolve("cancel") })
    return { editor, tabs: createFileTabs(editor), reportError }
  })
  useEffect(() => {
    let disposed = false
    void (async () => {
      for (let index = 0; index < count; index++) {
        if (disposed) return
        await state.tabs.openFile(filePath(index, longNames), true)
      }
      if (!disposed) state.tabs.activate(state.tabs.getSnapshot().tabs[0].id)
    })().catch((error) => {
      if (!disposed) state.reportError(error)
    })
    return () => {
      disposed = true
      state.tabs.dispose()
      state.editor.dispose()
    }
  }, [state, count, longNames])
  const tabs = ({ leading, trailing }: { leading?: ReactNode; trailing?: ReactNode } = {}) => (
    <FileTabs
      workspace={state.tabs}
      editor={state.editor}
      prefix="tab-layout"
      onError={state.reportError}
      leading={leading}
      trailing={trailing}
      labels={{
        newTab: "New tab",
        close: "Close",
        closeOthers: "Close others",
        closeRight: "Close to the right",
        closeSaved: "Close saved",
        closeAll: "Close all",
        copyPath: "Copy path",
        reveal: "Reveal"
      }}
    />
  )
  return (
    <div
      className="alwith-editor"
      dir={direction}
      style={{ width: 520, height: 160, margin: 32, transform: "translateX(24px)" }}
    >
      {controls ? (
        <PreviewSurface
          tree={(toggle) => <div>{toggle}File tree</div>}
          editor={tabs}
          treeVisible={treeVisible}
          onTreeVisibleChange={setTreeVisible}
          maximized={false}
          onMaximize={() => {}}
          onClose={() => {}}
        />
      ) : (
        tabs()
      )}
    </div>
  )
}

function pointer(target: EventTarget, type: string, x: number, y: number): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      isPrimary: true,
      pointerType: "mouse",
      pointerId: 1,
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      clientX: x,
      clientY: y
    })
  )
}

const meta = {
  title: "页面/文件树和预览区/标签拖动",
  tags: ["layout"],
  component: TabsExample,
  globals: { locale: "en" },
  parameters: { layout: "fullscreen", a11y: { test: "off" } }
} satisfies Meta<typeof TabsExample>
export default meta
type Story = StoryObj<typeof meta>

const followsPointer: NonNullable<Story["play"]> = async ({ canvas, canvasElement, parameters }) => {
  await waitFor(() => expect(canvas.getAllByRole("tab")).toHaveLength(3))
  const reverse = Boolean(parameters.reverse)
  const source = canvas.getByRole("tab", { name: reverse ? "2.txt" : "0.txt" })
  const neighbor = canvas.getByRole("tab", { name: "1.txt" })
  const destination = canvas.getByRole("tab", { name: reverse ? "0.txt" : "2.txt" })
  const start = source.closest("[data-tab-id]")!.getBoundingClientRect()
  const target = destination.closest("[data-tab-id]")!.getBoundingClientRect()
  const before = neighbor.closest("[data-tab-id]")!.getBoundingClientRect()
  const rects = [...canvasElement.querySelectorAll("[data-tab-id]")]
    .map((tab) => tab.getBoundingClientRect())
    .toSorted((a, b) => a.left - b.left)
  void expect(rects[1].left - rects[0].right).toBeCloseTo(4, 1)
  const x = start.left + start.width / 2
  const y = start.top + start.height / 2
  const dx = target.left - start.left
  try {
    pointer(source, "pointerdown", x, y)
    // The first move jumps outside the source, before any element-level pointer capture could begin.
    pointer(document, "pointermove", x + dx, y)
    await waitFor(() => expect(document.querySelector(".alwith-tab-drag-overlay")).not.toBeNull())
    pointer(document, "pointermove", x + dx, y + 20)
    await waitFor(() => {
      const overlay = document.querySelector<HTMLElement>(".alwith-tab-drag-overlay")!
      void expect(overlay.getBoundingClientRect().left).toBeCloseTo(target.left, 0)
      void expect(overlay.getBoundingClientRect().top).toBeCloseTo(start.top, 0)
      void expect(Math.abs(neighbor.closest("[data-tab-id]")!.getBoundingClientRect().left - before.left)).toBeGreaterThan(
        start.width - 2
      )
    })
    pointer(document, "pointerup", x + dx, y + 20)
    await waitFor(() => {
      void expect(document.querySelector(".alwith-tab-drag-overlay")).toBeNull()
      void expect(source.closest("[data-tab-id]")!.getBoundingClientRect().left).toBeCloseTo(target.left, 0)
      void expect([...canvasElement.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual(
        reverse ? ["2.txt", "0.txt", "1.txt"] : ["1.txt", "2.txt", "0.txt"]
      )
    })
  } finally {
    pointer(document, "pointercancel", x, y)
  }
}

export const MoveRight: Story = { play: followsPointer }
export const MoveLeft: Story = { parameters: { reverse: true }, play: followsPointer }
export const MoveRtl: Story = { args: { direction: "rtl" }, play: followsPointer }
export const MoveBackRtl: Story = { args: { direction: "rtl" }, parameters: { reverse: true }, play: followsPointer }

export const Cancel: Story = {
  play: async ({ canvas }) => {
    await waitFor(() => expect(canvas.getAllByRole("tab")).toHaveLength(3))
    const source = canvas.getByRole("tab", { name: "0.txt" })
    const start = source.getBoundingClientRect()
    const x = start.left + start.width / 2
    const y = start.top + start.height / 2
    try {
      pointer(source, "pointerdown", x, y)
      pointer(document, "pointermove", x + 200, y)
      await waitFor(() => expect(document.querySelector(".alwith-tab-drag-overlay")).not.toBeNull())
      pointer(document, "pointermove", x + 200, y)
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }))
      await waitFor(() => {
        void expect(document.querySelector(".alwith-tab-drag-overlay")).toBeNull()
        void expect(source.getBoundingClientRect().left).toBeCloseTo(start.left, 0)
      })
    } finally {
      pointer(document, "pointercancel", x, y)
    }
  }
}

const scrollsAtEdge: NonNullable<Story["play"]> = async ({ canvas, canvasElement, args }) => {
  await waitFor(() => expect(canvas.getAllByRole("tab")).toHaveLength(12))
  const scroll = canvasElement.querySelector<HTMLElement>(".alwith-workspace-tab-scroll")!
  await waitFor(() => expect(scroll.scrollLeft).toBe(0))
  const source = canvas.getByRole("tab", { name: "0.txt" })
  const start = source.closest("[data-tab-id]")!.getBoundingClientRect()
  const viewport = scroll.getBoundingClientRect()
  const x = start.left + start.width / 2
  const y = start.top + start.height / 2
  const edge = args.direction === "rtl" ? viewport.left + 1 : viewport.right - 1
  try {
    pointer(source, "pointerdown", x, y)
    pointer(document, "pointermove", edge, y)
    await waitFor(() => expect(document.querySelector(".alwith-tab-drag-overlay")).not.toBeNull())
    pointer(document, "pointermove", edge, y)
    await waitFor(() => expect(Math.abs(scroll.scrollLeft)).toBeGreaterThan(100))
    const overlay = document.querySelector<HTMLElement>(".alwith-tab-drag-overlay")!
    void expect(overlay.getBoundingClientRect().left).toBeGreaterThanOrEqual(viewport.left - 1)
    void expect(overlay.getBoundingClientRect().right).toBeLessThanOrEqual(viewport.right + 1)
  } finally {
    pointer(document, "pointercancel", x, y)
  }
}

export const Overflow: Story = { args: { count: 12 }, play: scrollsAtEdge }
export const OverflowRtl: Story = { args: { count: 12, direction: "rtl" }, play: scrollsAtEdge }

export const HeaderControls: Story = {
  args: { controls: true },
  loaders: [() => initI18n("en")],
  play: async ({ canvas, canvasElement }) => {
    await waitFor(() => expect(canvas.getAllByRole("tab")).toHaveLength(3))
    const buttons = [...canvasElement.querySelectorAll<HTMLButtonElement>(".alwith-tab-action")]
    void expect(buttons).toHaveLength(4)
    for (const button of buttons) {
      void expect(button.getBoundingClientRect().width).toBe(30)
      void expect(button.getBoundingClientRect().height).toBe(30)
      const icon = button.querySelector("svg")!
      void expect(icon.classList.contains("lucide")).toBe(true)
      void expect(icon).toHaveAttribute("viewBox", "0 0 24 24")
      void expect(getComputedStyle(icon).strokeWidth).toBe("2px")
      void expect(getComputedStyle(icon).strokeLinecap).toBe("round")
      void expect(getComputedStyle(icon).strokeLinejoin).toBe("round")
      void expect(icon.getBoundingClientRect().width).toBe(16)
      void expect(icon.getBoundingClientRect().height).toBe(16)
    }
    for (const icon of canvasElement.querySelectorAll(".alwith-workspace-tab-close svg")) {
      void expect(icon.getBoundingClientRect().width).toBe(16)
      void expect(icon.getBoundingClientRect().height).toBe(16)
      void expect(icon.closest("button")!.getBoundingClientRect().width).toBe(24)
      void expect(icon.closest("button")!.getBoundingClientRect().height).toBe(24)
    }
    if (import.meta.env.STORYBOOK_TEST) {
      const { page } = await import("vitest/browser")
      const close = canvasElement.querySelector<HTMLButtonElement>(
        '.alwith-workspace-tab[data-active="true"] .alwith-workspace-tab-close'
      )!
      await page.getByRole("button", { name: close.getAttribute("aria-label")!, exact: true }).hover()
      const hoverProbe = document.createElement("span")
      hoverProbe.style.background = "color-mix(in oklab, var(--foreground) 8%, transparent)"
      document.body.append(hoverProbe)
      await waitFor(() =>
        expect(getComputedStyle(close).backgroundColor).toBe(getComputedStyle(hoverProbe).backgroundColor)
      )
      hoverProbe.remove()
      const probe = document.createElement("span")
      probe.style.background = "var(--chrome-hover-background)"
      document.body.append(probe)
      const expected = getComputedStyle(probe).backgroundColor
      probe.remove()
      for (const button of buttons) {
        await page.getByRole("button", { name: button.getAttribute("aria-label")!, exact: true }).hover()
        await waitFor(() => expect(getComputedStyle(button).backgroundColor).toBe(expected))
        await waitFor(() => {
          const tooltip = [...document.querySelectorAll<HTMLElement>('[role="tooltip"]')].find(
            (element) =>
              element.textContent?.includes(button.getAttribute("aria-label")!) && !element.hasAttribute("data-closed")
          )
          void expect(tooltip).toBeDefined()
          void expect(tooltip).toHaveAttribute("data-side", "bottom")
          void expect(tooltip!.getBoundingClientRect().top).toBeGreaterThanOrEqual(button.getBoundingClientRect().bottom)
        })
      }
    }
  }
}

export const FileNameTruncation: Story = {
  args: { longNames: true },
  play: async ({ canvas, userEvent }) => {
    await waitFor(() => expect(canvas.getAllByRole("tab")).toHaveLength(3))
    const [first, second, short] = canvas.getAllByRole("tab")
    const firstTitle = first.querySelector<HTMLElement>(".alwith-workspace-tab-title")!
    const secondTitle = second.querySelector<HTMLElement>(".alwith-workspace-tab-title")!
    const shortTitle = short.querySelector<HTMLElement>(".alwith-workspace-tab-title")!
    await waitFor(() => {
      void expect(firstTitle).toHaveAttribute("data-overflow", "true")
      void expect(secondTitle).toHaveAttribute("data-overflow", "true")
      void expect(shortTitle).toHaveAttribute("data-overflow", "false")
      void expect(getComputedStyle(firstTitle).textOverflow).toBe("clip")
      void expect(getComputedStyle(firstTitle).maskImage).not.toBe("none")
      void expect(getComputedStyle(shortTitle).maskImage).toBe("none")
      void expect(getComputedStyle(first).paddingInlineEnd).toBe("34px")
      void expect(getComputedStyle(second).paddingInlineEnd).toBe("9px")
      void expect(secondTitle.clientWidth - firstTitle.clientWidth).toBe(25)
    })
    await userEvent.click(second)
    await waitFor(() => {
      void expect(getComputedStyle(first).paddingInlineEnd).toBe("9px")
      void expect(getComputedStyle(second).paddingInlineEnd).toBe("34px")
      void expect(firstTitle.clientWidth - secondTitle.clientWidth).toBe(25)
    })
  }
}

export const WorkspaceHeaderLayout: Story = {
  args: { controls: true, count: 10 },
  loaders: [() => initI18n("en")],
  play: async ({ canvas, canvasElement, userEvent }) => {
    await waitFor(() => expect(canvas.getAllByRole("tab")).toHaveLength(10))
    const bar = canvasElement.querySelector<HTMLElement>(".alwith-tab-strip")!
    const surface = canvasElement.querySelector<HTMLElement>(".workspace-preview-surface")!
    const scroll = canvasElement.querySelector<HTMLElement>(".alwith-workspace-tab-scroll")!
    const add = canvasElement.querySelector<HTMLElement>(".alwith-workspace-new-tab")!
    const controls = canvasElement.querySelector<HTMLElement>(".alwith-tab-controls")!
    void expect(scroll.contains(add)).toBe(false)
    void expect(bar.getBoundingClientRect().width).toBe(surface.getBoundingClientRect().width)
    const before = add.getBoundingClientRect().left
    scroll.scrollLeft = 200
    await waitFor(() => expect(scroll.scrollLeft).toBeGreaterThan(0))
    void expect(add.getBoundingClientRect().left).toBe(before)
    void expect(controls.getBoundingClientRect().left - add.getBoundingClientRect().right).toBe(16)
    await userEvent.click(canvas.getByRole("button", { name: "Show file tree" }))
    await waitFor(() => {
      const tree = canvasElement.querySelector<HTMLElement>(".file-workspace-tree")!
      const editor = canvasElement.querySelector<HTMLElement>(".file-workspace-editor")!
      void expect(tree).toHaveAttribute("aria-hidden", "false")
      void expect(tree.getBoundingClientRect().left).toBeGreaterThanOrEqual(editor.getBoundingClientRect().right - 1)
      void expect(tree.getBoundingClientRect().top).toBe(bar.getBoundingClientRect().top)
      void expect(bar.getBoundingClientRect().width).toBe(editor.getBoundingClientRect().width)
      void expect(bar.getBoundingClientRect().width).toBeLessThan(surface.getBoundingClientRect().width)
      void expect(editor.getBoundingClientRect().top).toBe(bar.getBoundingClientRect().bottom)
    })
    const hide = canvas.getByRole("button", { name: "Hide file tree" })
    void expect(hide.closest(".file-workspace-tree")).not.toBeNull()
    void expect(bar.contains(hide)).toBe(false)
    await userEvent.click(hide)
    await waitFor(() => {
      const show = canvas.getByRole("button", { name: "Show file tree" })
      void expect(bar.contains(show)).toBe(true)
      void expect(bar.getBoundingClientRect().width).toBe(surface.getBoundingClientRect().width)
    })
    void expect(canvas.getByRole("button", { name: "Close workspace" })).toBeVisible()
  }
}

export const CloseTitleFade: Story = {
  args: { longNames: true },
  play: async ({ canvas, canvasElement }) => {
    await waitFor(() => expect(canvas.getAllByRole("tab")).toHaveLength(3))
    if (!import.meta.env.STORYBOOK_TEST) return
    const { page } = await import("vitest/browser")
    const tab = canvas.getAllByRole("tab")[1]
    const title = tab.querySelector<HTMLElement>(".alwith-workspace-tab-title")!
    const close = tab.parentElement!.querySelector<HTMLButtonElement>(".alwith-workspace-tab-close")!
    await waitFor(() => expect(canvas.getAllByRole("tab")[0]).toHaveAttribute("aria-selected", "true"))
    await Promise.all(canvasElement.getAnimations({ subtree: true }).map((animation) => animation.finished))
    const width = title.clientWidth
    await page.getByRole("tab", { name: title.textContent!, exact: true }).hover()
    await waitFor(() => {
      void expect(getComputedStyle(title).getPropertyValue("--file-tab-title-occlusion").trim()).toBe("25px")
      void expect(getComputedStyle(title).maskImage).toContain("100% - 25px")
      void expect(title.clientWidth).toBe(width)
      void expect(title.getBoundingClientRect().right - 25).toBeLessThan(close.getBoundingClientRect().left)
    })
    await page.getByRole("button", { name: close.getAttribute("aria-label")!, exact: true }).hover()
    void expect(getComputedStyle(title).maskImage).toContain("100% - 25px")
    void expect(title.clientWidth).toBe(width)
    await page.getByRole("button", { name: "New tab", exact: true }).hover()
    await waitFor(() =>
      expect(getComputedStyle(title).getPropertyValue("--file-tab-title-occlusion").trim()).toBe("0px")
    )
    void expect(canvasElement.querySelectorAll(".alwith-workspace-tab")).toHaveLength(3)
  }
}

export const NewTabDockDivider: Story = {
  args: { controls: true, count: 1 },
  loaders: [() => initI18n("en")],
  play: async ({ canvas, canvasElement }) => {
    await waitFor(() => expect(canvas.getAllByRole("tab")).toHaveLength(1))
    const host = canvasElement.querySelector<HTMLElement>(".alwith-editor")!
    const controls = canvasElement.querySelector<HTMLElement>(".alwith-tab-controls")!
    await waitFor(() => expect(controls).toHaveAttribute("data-new-tab-docked", "false"))
    void expect(getComputedStyle(controls, "::before").content).toBe("none")
    host.style.width = "300px"
    await waitFor(() => expect(controls).toHaveAttribute("data-new-tab-docked", "true"))
    void expect(getComputedStyle(controls, "::before").width).toBe("1px")
    void expect(getComputedStyle(controls, "::before").height).toBe("16px")
    host.style.width = "520px"
    await waitFor(() => expect(controls).toHaveAttribute("data-new-tab-docked", "false"))
    void expect(getComputedStyle(controls, "::before").content).toBe("none")
  }
}

export const SidebarIconParity: Story = {
  loaders: [() => initI18n("en")],
  render: () => (
    <>
      <div
        className="main-sidebar-panel"
        data-icon-reference
        style={{ "--spacing": "4px", width: 160 } as import("react").CSSProperties}
      >
        <SidebarButton
          variant="ghost"
          size="icon-sm"
          className="size-[var(--navigation-row-height,30px)] p-0"
          aria-label="Reference new"
        >
          <Plus />
        </SidebarButton>
      </div>
      <TabsExample controls />
    </>
  ),
  play: async ({ canvasElement, canvas }) => {
    await waitFor(() => expect(canvas.getAllByRole("tab")).toHaveLength(3))
    const reference = canvasElement.querySelector<SVGSVGElement>("[data-icon-reference] svg")!
    void expect(reference.getBoundingClientRect().width).toBe(16)
    if (import.meta.env.STORYBOOK_TEST) {
      const { page } = await import("vitest/browser")
      await page.getByRole("button", { name: "Reference new", exact: true }).hover()
      const referenceButton = reference.closest("button")!
      await waitFor(() => expect(getComputedStyle(referenceButton).backgroundColor).not.toBe("rgba(0, 0, 0, 0)"))
      const probe = document.createElement("span")
      probe.style.background = "var(--chrome-hover-background)"
      document.body.append(probe)
      const background = getComputedStyle(probe).backgroundColor
      probe.remove()
      await waitFor(() => expect(getComputedStyle(referenceButton).backgroundColor).toBe(background))
      for (const button of canvasElement.querySelectorAll<HTMLButtonElement>(".alwith-tab-action")) {
        await page.getByRole("button", { name: button.getAttribute("aria-label")!, exact: true }).hover()
        await waitFor(() => expect(getComputedStyle(button).backgroundColor).toBe(background))
      }
    }

    for (const icon of canvasElement.querySelectorAll<SVGSVGElement>(".alwith-tab-action svg")) {
      const button = icon.closest("button")!
      const referenceButton = reference.closest("button")!
      void expect(button.getBoundingClientRect().width).toBe(referenceButton.getBoundingClientRect().width)
      void expect(button.getBoundingClientRect().height).toBe(referenceButton.getBoundingClientRect().height)
      for (const property of ["borderTopWidth", "borderTopColor", "borderRadius", "padding", "boxSizing"] as const) {
        void expect(getComputedStyle(button)[property]).toBe(getComputedStyle(referenceButton)[property])
      }
      void expect(icon).toHaveClass("size-4")
      void expect(icon.getBoundingClientRect().width).toBe(reference.getBoundingClientRect().width)
      void expect(icon.getBoundingClientRect().height).toBe(reference.getBoundingClientRect().height)
      void expect(getComputedStyle(icon).strokeWidth).toBe(getComputedStyle(reference).strokeWidth)
      void expect(icon.getScreenCTM()!.a).toBe(reference.getScreenCTM()!.a)
      void expect(icon.getScreenCTM()!.d).toBe(reference.getScreenCTM()!.d)
    }
  }
}

export const DragBounds: Story = {
  play: async ({ canvas, canvasElement }) => {
    await waitFor(() => expect(canvas.getAllByRole("tab")).toHaveLength(3))
    const source = canvas.getByRole("tab", { name: "1.txt" })
    const start = source.closest("[data-tab-id]")!.getBoundingClientRect()
    const scroll = canvasElement.querySelector<HTMLElement>(".alwith-workspace-tab-scroll")!
    const bounds = scroll.getBoundingClientRect()
    const x = start.left + start.width / 2
    const y = start.top + start.height / 2
    try {
      pointer(source, "pointerdown", x, y)
      pointer(document, "pointermove", x + 10, y)
      await waitFor(() => expect(document.querySelector(".alwith-tab-drag-overlay")).not.toBeNull())
      for (const edge of [bounds.left - 300, bounds.right + 300]) {
        pointer(document, "pointermove", edge, y + 100)
        await waitFor(() => {
          const rect = document.querySelector(".alwith-tab-drag-overlay")!.getBoundingClientRect()
          void expect(rect.left).toBeGreaterThanOrEqual(bounds.left - 1)
          void expect(rect.right).toBeLessThanOrEqual(bounds.right + 1)
          void expect(rect.top).toBeCloseTo(start.top, 0)
          void expect(edge < bounds.left ? rect.left : rect.right).toBeCloseTo(
            edge < bounds.left ? bounds.left : bounds.right,
            0
          )
        })
      }
    } finally {
      pointer(document, "pointercancel", x, y)
    }
  }
}
export const DragBoundsRtl: Story = { ...DragBounds, args: { direction: "rtl" } }
