import { desktopDefaults } from "@nyssance/atlas/layout"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { useContext, useRef, useState } from "react"
import { expect, waitFor } from "storybook/test"

import { Button } from "../../../src/components/ui/button"
import { SidebarInset } from "../../../src/components/ui/sidebar"
import { type MainScreen, MainSidebarLayout } from "../../../src/features/layout/components/main-sidebar-layout"
import { CanvasContext } from "../../../src/features/layout/lib/canvas-context"
import type { PanelControls } from "../../../src/features/workspace/panel-controls-context"
import { PreviewSurface } from "../../../src/features/workspace/preview-surface"
import { WorkspacePanels } from "../../../src/features/workspace/workspace-panels"
import i18n from "../../../src/lib/i18n"

function ReturnToChat({ restore }: { restore: () => void }) {
  const canvas = useContext(CanvasContext)
  return (
    <Button
      onClick={() => {
        restore()
        canvas?.navigate("chat")
      }}
    >
      Return to chat
    </Button>
  )
}

async function hoverNavigationEdge(canvas: HTMLElement): Promise<void> {
  const host = canvas.querySelector<HTMLElement>("[data-canvas-moving]")!
  await waitFor(() => expect(host).toHaveAttribute("data-canvas-moving", "false"), { timeout: 3000 })
  const root = canvas.querySelector<HTMLElement>("[data-atlas-viewport]")!
  const bounds = root.getBoundingClientRect()
  root.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      pointerType: "mouse",
      clientX: bounds.left + bounds.width / 2,
      clientY: bounds.top + 100
    })
  )
  root.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      pointerType: "mouse",
      clientX: i18n.dir() === "rtl" ? bounds.right - 2 : bounds.left + 2,
      clientY: bounds.top + 100
    })
  )
  const surface = canvas.querySelector<HTMLElement>("[data-atlas-navigation-surface]")!
  await waitFor(
    async () => {
      await expect(host).not.toHaveAttribute("data-sidebar-mode", "hidden")
      await expect(surface.inert).toBe(false)
      await expect(getComputedStyle(surface).pointerEvents).not.toBe("none")
    },
    { timeout: 3000 }
  )
}

const meta = {
  id: "页面-导航与项目-画布细节",
  globals: { locale: "en" },
  title: "页面/主窗整体/导航与项目/画布细节",
  component: MainSidebarLayout,
  parameters: { layout: "fullscreen" }
} satisfies Meta<typeof MainSidebarLayout>
export default meta
type Story = StoryObj<typeof meta>

export const Unified: Story = {
  name: "统一布局",
  args: {
    initialPinned: true,
    screen: "main",
    sidebar: null,
    leading: null,
    main: null
  },
  render: function Render(args, { parameters }) {
    const panelControls = useRef<PanelControls | null>(null)
    const [screen, setScreen] = useState<MainScreen>("main")
    const [visible, setVisible] = useState(true)
    const [maximized, setMaximized] = useState(false)
    const [width, setWidth] = useState(640)
    return (
      <div>
        <Button onClick={() => setWidth(1200)}>Wide layout</Button>
        <Button onClick={() => setWidth(640)}>Narrow layout</Button>
        {parameters.externalActions && (
          <Button
            onClick={() => {
              setVisible(false)
              setMaximized(false)
            }}
          >
            Close externally
          </Button>
        )}
        <div className="h-[600px] bg-sidebar" style={{ width }}>
          <MainSidebarLayout
            {...args}
            screen={screen}
            onScreenChange={setScreen}
            toolbar={
              <Button
                onClick={() => {
                  if (panelControls.current?.expanded) panelControls.current.toggleExpanded()
                  else setVisible(!visible)
                }}
              >
                {parameters.titlebarToggle ? (visible ? "Close workspace" : "Open workspace") : "Open workspace"}
              </Button>
            }
            sidebar={
              <div className="h-full bg-sidebar p-4">
                <h2>Navigation</h2>
                <Button onClick={() => setScreen("leading")}>Leading</Button>
                <Button onClick={() => setScreen("main")}>Chat</Button>
              </div>
            }
            leading={
              <div className="p-4">
                <h1>Leading page</h1>
              </div>
            }
            main={
              <SidebarInset className="main-chat-surface main-workspace-surface flex min-h-0 flex-col">
                <WorkspacePanels
                  controlsRef={panelControls}
                  visible={visible}
                  maximized={maximized}
                  onVisibleChange={setVisible}
                  onMaximizedChange={setMaximized}
                  chat={
                    <div className="p-4">
                      <h1>Chat pane</h1>
                      <textarea aria-label="Draft" defaultValue="Preserved draft" />
                      <Button onClick={() => setVisible(!visible)}>Toggle preview</Button>
                    </div>
                  }
                  preview={
                    <div className="p-4">
                      <h1>Preview pane</h1>
                      {parameters.realPreviewControls ? (
                        <div style={{ height: 100 }}>
                          <PreviewSurface
                            tree={null}
                            treeVisible={false}
                            onTreeVisibleChange={() => {}}
                            maximized={maximized}
                            onMaximize={() => setMaximized(!maximized)}
                            onClose={() => setVisible(false)}
                            editor={({ trailing }) => (
                              <div>
                                {trailing}
                                <input aria-label="Editor draft" defaultValue="Preserved edit" />
                              </div>
                            )}
                          />
                        </div>
                      ) : (
                        <Button onClick={() => setMaximized(!maximized)}>Maximize</Button>
                      )}
                      <Button
                        onClick={() => {
                          setVisible(false)
                          setMaximized(false)
                        }}
                      >
                        Close preview
                      </Button>
                      <ReturnToChat restore={() => setMaximized(false)} />
                    </div>
                  }
                />
              </SidebarInset>
            }
          />
        </div>
      </div>
    )
  },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const dots = (): HTMLButtonElement[] => [
      ...canvasElement.querySelectorAll<HTMLButtonElement>(".canvas-dots button")
    ]
    await waitFor(() => expect(dots()).toHaveLength(2))
    await hoverNavigationEdge(canvasElement)
    await userEvent.click(await canvas.findByRole("button", { name: "Leading" }))
    await waitFor(() => expect(canvas.getByRole("heading", { name: "Leading page" })).toBeVisible())
    await hoverNavigationEdge(canvasElement)
    await userEvent.click(await canvas.findByRole("button", { name: /^Chat$/ }))
    await waitFor(() => expect(canvas.getByRole("textbox", { name: "Draft" })).toHaveValue("Preserved draft"))
    await waitFor(
      async () => {
        const root = canvasElement.querySelector(".main-window-body")!.getBoundingClientRect()
        const chat = canvasElement.querySelector(".file-workspace-chat")!.getBoundingClientRect()
        await expect(chat.left).toBeGreaterThanOrEqual(root.left)
        await expect(chat.right).toBeLessThanOrEqual(root.right + 1)
      },
      { timeout: 3000 }
    )
    await userEvent.click(dots()[1])
    await waitFor(() => expect(canvas.getByRole("button", { name: "Maximize" })).toBeVisible())
    await userEvent.click(canvas.getByRole("button", { name: "Wide layout" }))
    await waitFor(() => expect(dots()).toHaveLength(0))
    await userEvent.click(canvas.getByRole("button", { name: "Narrow layout" }))
    await waitFor(() => expect(dots()[1]).toHaveAttribute("aria-current", "page"))
    await userEvent.click(dots()[0])
    await userEvent.click(canvas.getByRole("button", { name: "Toggle preview" }))
    await waitFor(() => expect(dots()).toHaveLength(0))
    await userEvent.click(canvas.getByRole("button", { name: "Toggle preview" }))
    await waitFor(() => expect(dots()[1]).toHaveAttribute("aria-current", "page"))
  }
}

export const Floating: Story = {
  ...Unified,
  name: "浮动侧栏",
  args: { ...Unified.args, initialPinned: false }
}

export const RightToLeft: Story = { ...Unified, name: "从右向左布局", globals: { locale: "ar" } }

export const DirectionChange: Story = {
  ...Unified,
  name: "切换布局方向",
  globals: { locale: "en" },
  play: async ({ canvasElement, userEvent }) => {
    const dots = (): HTMLButtonElement[] => [
      ...canvasElement.querySelectorAll<HTMLButtonElement>(".canvas-dots button")
    ]
    await waitFor(() => expect(dots()).toHaveLength(2))
    await userEvent.click(dots()[1])
    await i18n.changeLanguage("ar")
    await waitFor(
      async () => {
        await expect(dots()[1]).toHaveAttribute("aria-current", "page")
        const root = canvasElement.querySelector(".main-window-body")!.getBoundingClientRect()
        const preview = canvasElement.querySelector(".file-workspace-panel")!.getBoundingClientRect()
        await expect(preview.left).toBeGreaterThanOrEqual(root.left - 1)
        await expect(preview.right).toBeLessThanOrEqual(root.right + 1)
      },
      { timeout: 3000 }
    )
    await i18n.changeLanguage("en")
    await waitFor(() => expect(dots()[1]).toHaveAttribute("aria-current", "page"))
  }
}

export const ReturnFromPreview: Story = {
  ...Unified,
  name: "从预览返回聊天",
  globals: { locale: "en" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const dots = (): HTMLButtonElement[] => [
      ...canvasElement.querySelectorAll<HTMLButtonElement>(".canvas-dots button")
    ]
    const host = canvasElement.querySelector<HTMLElement>("[data-sidebar-mode]")!
    const sidebar = canvasElement.querySelector<HTMLElement>(".main-sidebar-panel")!
    await waitFor(() => expect(dots()).toHaveLength(2))
    for (let round = 0; round < 3; round++) {
      await userEvent.click(dots()[1])
      await waitFor(() => expect(host).toHaveAttribute("data-sidebar-mode", "hidden"))
      await waitFor(() => expect(host).toHaveAttribute("data-canvas-moving", "false"), { timeout: 3000 })
      await expect(canvas.queryByRole("switch")).not.toBeInTheDocument()
      await hoverNavigationEdge(canvasElement)
      await waitFor(() => expect(host).toHaveAttribute("data-sidebar-mode", "floating"))
      await userEvent.click(dots()[0])
      await waitFor(async () => {
        await expect(host).toHaveAttribute("data-sidebar-mode", "pinned")
        await expect(host).toHaveAttribute("data-sidebar-presentation", "docked")
        const chat = canvasElement.querySelector(".file-workspace-chat")!.getBoundingClientRect()
        if (i18n.dir() === "rtl") await expect(sidebar.getBoundingClientRect().left).toBeGreaterThanOrEqual(chat.right)
        else await expect(sidebar.getBoundingClientRect().right).toBeLessThanOrEqual(chat.left)
      })
      await expect(canvas.getByRole("textbox", { name: "Draft" })).toHaveValue("Preserved draft")
    }
  }
}

export const ReturnFromPreviewRtl: Story = {
  ...ReturnFromPreview,
  name: "从预览返回聊天 · 从右向左",
  globals: { locale: "ar" }
}

export const ReflowWithFloatingSidebar: Story = {
  ...Unified,
  name: "浮动侧栏下的布局重排",
  globals: { locale: "en" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const dots = (): HTMLButtonElement[] => [
      ...canvasElement.querySelectorAll<HTMLButtonElement>(".canvas-dots button")
    ]
    const host = canvasElement.querySelector<HTMLElement>("[data-sidebar-mode]")!
    const sidebar = canvasElement.querySelector<HTMLElement>(".main-sidebar-panel")!
    for (const action of ["Wide layout", "Maximize"]) {
      await waitFor(() => expect(dots()).toHaveLength(2))
      await userEvent.click(dots()[1])
      await waitFor(() => expect(host).toHaveAttribute("data-canvas-moving", "false"), { timeout: 3000 })
      await expect(canvas.queryByRole("switch")).not.toBeInTheDocument()
      await hoverNavigationEdge(canvasElement)
      await waitFor(() => expect(host).toHaveAttribute("data-sidebar-mode", "floating"))
      await userEvent.click(canvas.getByRole("button", { name: action }))
      await waitFor(
        async () => {
          await expect(dots()).toHaveLength(0)
          await expect(host).toHaveAttribute("data-sidebar-mode", "pinned")
          await expect(host).toHaveAttribute("data-sidebar-presentation", "docked")
          await expect(getComputedStyle(sidebar).borderRadius).toBe("0px")
          const body = canvasElement.querySelector(".main-window-body")!.getBoundingClientRect()
          await expect(sidebar.getBoundingClientRect().left).toBeCloseTo(body.left + 4, 0)
          const preview = canvasElement.querySelector(".file-workspace-panel")!.getBoundingClientRect()
          await expect(sidebar.getBoundingClientRect().right).toBeLessThanOrEqual(preview.left)
          await expect(preview.right).toBeLessThanOrEqual(body.right + 1)
        },
        { timeout: 3000 }
      )
      if (action === "Wide layout") await userEvent.click(canvas.getByRole("button", { name: "Narrow layout" }))
    }
  }
}

export const HidePinnedNavigation: Story = {
  ...Unified,
  name: "隐藏固定导航",
  globals: { locale: "en" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Wide layout" }))
    const host = canvasElement.querySelector<HTMLElement>("[data-sidebar-mode]")!
    const chat = canvasElement.querySelector<HTMLElement>(".file-workspace-chat")!
    const preview = canvasElement.querySelector<HTMLElement>(".file-workspace-panel")!
    await waitFor(() => expect(canvasElement.querySelector(".main-window-body")!.clientWidth).toBe(1200))
    await userEvent.click(canvas.getByRole("switch"))
    await waitFor(
      async () => {
        await expect(host).toHaveAttribute("data-sidebar-mode", "hidden")
        const body = canvasElement.querySelector(".main-window-body")!.getBoundingClientRect()
        await expect(chat.getBoundingClientRect().left).toBeGreaterThanOrEqual(body.left)
        await expect(preview.getBoundingClientRect().right).toBeCloseTo(body.right - desktopDefaults.gutter * 1.5, 0)
        await expect(chat.getBoundingClientRect().width).toBeCloseTo(preview.getBoundingClientRect().width, 0)
      },
      { timeout: 3000 }
    )
  }
}

export const HideNavigationAfterManualSplit: Story = {
  ...Unified,
  name: "手动分栏后隐藏导航",
  globals: { locale: "en" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Wide layout" }))
    const dots = (): HTMLButtonElement[] => [
      ...canvasElement.querySelectorAll<HTMLButtonElement>(".canvas-dots button")
    ]
    await waitFor(() => expect(dots()).toHaveLength(0))
    await userEvent.click(canvas.getByRole("separator"))
    for (let index = 0; index < 4; index++) await userEvent.keyboard("{ArrowRight}")
    await waitFor(() => expect(dots()).toHaveLength(2))
    await userEvent.click(canvas.getByRole("switch"))
    await waitFor(async () => {
      await expect(dots()).toHaveLength(2)
      const body = canvasElement.querySelector(".main-window-body")!
      const slides = canvasElement.querySelectorAll<HTMLElement>(".file-workspace-slide")
      await expect(slides[0].getBoundingClientRect().width).toBe(body.clientWidth - 8)
      await expect(slides[1].getBoundingClientRect().width).toBe(body.clientWidth - 8)
    })
    await userEvent.click(dots()[1])
    await userEvent.click(canvas.getByRole("separator"))
    await userEvent.keyboard("{ArrowLeft}")
    await waitFor(() => expect(dots()).toHaveLength(0))
  }
}

export const OperationChain: Story = {
  ...Unified,
  name: "连续操作",
  globals: { locale: "en" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const dots = (): HTMLButtonElement[] => [
      ...canvasElement.querySelectorAll<HTMLButtonElement>(".canvas-dots button")
    ]
    const host = canvasElement.querySelector<HTMLElement>("[data-sidebar-mode]")!
    const body = canvasElement.querySelector<HTMLElement>(".main-window-body")!
    const chat = canvasElement.querySelector<HTMLElement>(".file-workspace-chat")!
    const preview = canvasElement.querySelector<HTMLElement>(".file-workspace-panel")!
    const sidebar = canvasElement.querySelector<HTMLElement>(".main-sidebar-panel")!
    const assertScreen = async (index: number): Promise<void> => {
      await waitFor(
        async () => {
          if (index > 0 && dots().length > 0) await expect(dots()[index - 1]).toHaveAttribute("aria-current", "page")
          await expect(host).toHaveAttribute("data-main-screen", index === 0 ? "leading" : "main")
          const bounds = body.getBoundingClientRect()
          const panel = (index === 2 ? preview : chat).getBoundingClientRect()
          await expect(panel.width).toBeGreaterThan(300)
          await expect(panel.left).toBeGreaterThanOrEqual(bounds.left - 1)
          await expect(panel.right).toBeLessThanOrEqual(bounds.right + 1)
          if (host.dataset.sidebarMode === "pinned") {
            await expect(host).toHaveAttribute("data-sidebar-presentation", "docked")
            const nav = sidebar.getBoundingClientRect()
            if (i18n.dir() === "rtl") await expect(panel.right).toBeLessThanOrEqual(nav.left)
            else await expect(panel.left).toBeGreaterThanOrEqual(nav.right)
          }
        },
        { timeout: 3000 }
      )
    }
    await userEvent.click(canvas.getByRole("button", { name: "Wide layout" }))
    await waitFor(() => expect(dots()).toHaveLength(0))
    if (canvas.getByRole("switch").getAttribute("aria-checked") === "false")
      await userEvent.click(canvas.getByRole("switch"))
    const draft = canvas.getByRole("textbox", { name: "Draft" })
    await userEvent.type(draft, " / chain")
    await userEvent.click(canvas.getByRole("separator"))
    const shrink = i18n.dir() === "rtl" ? "{ArrowLeft}" : "{ArrowRight}"
    for (let index = 0; index < 5; index++) await userEvent.keyboard(shrink)
    await waitFor(() => expect(dots()).toHaveLength(2))
    await userEvent.click(canvas.getByRole("switch"))
    await assertScreen(1)
    for (let round = 0; round < 3; round++) {
      await userEvent.click(dots()[1])
      await assertScreen(2)
      await waitFor(() => expect(host).toHaveAttribute("data-canvas-moving", "false"), { timeout: 3000 })
      await expect(canvas.queryByRole("switch")).not.toBeInTheDocument()
      await hoverNavigationEdge(canvasElement)
      await waitFor(() => expect(host).toHaveAttribute("data-sidebar-mode", "floating"))
      await userEvent.click(canvas.getByRole("button", { name: "Return to chat" }))
      await assertScreen(1)
      await hoverNavigationEdge(canvasElement)
      await userEvent.click(await canvas.findByRole("button", { name: "Leading" }))
      await waitFor(() => expect(host).toHaveAttribute("data-main-screen", "leading"))
      await userEvent.click(await canvas.findByRole("button", { name: /^Chat$/ }))
      await assertScreen(1)
    }
    await userEvent.click(canvas.getByRole("switch"))
    await assertScreen(1)
    await userEvent.click(canvas.getByRole("button", { name: "Narrow layout" }))
    await assertScreen(1)
    await userEvent.click(dots()[1])
    await assertScreen(2)
    await userEvent.click(canvas.getByRole("button", { name: "Maximize" }))
    await waitFor(() => expect(dots()).toHaveLength(0))
    await userEvent.click(canvas.getByRole("button", { name: "Return to chat" }))
    await assertScreen(1)
    await userEvent.click(dots()[1])
    await assertScreen(2)
    await userEvent.click(canvas.getByRole("button", { name: "Close preview" }))
    await waitFor(() => expect(dots()).toHaveLength(0))
    await assertScreen(1)
    await expect(draft).toHaveValue("Preserved draft / chain")
    await userEvent.click(canvas.getByRole("button", { name: "Toggle preview" }))
    await assertScreen(2)
  }
}

export const OperationChainRtl: Story = {
  ...OperationChain,
  name: "连续操作 · 从右向左",
  globals: { locale: "ar" }
}
export const OperationChainFloating: Story = {
  ...OperationChain,
  name: "连续操作 · 浮动侧栏",
  args: { ...Unified.args, initialPinned: false }
}

export const PointerSplitAndReverse: Story = {
  ...Unified,
  name: "拖动分栏与反向调整",
  globals: { locale: "en" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Wide layout" }))
    const dots = (): HTMLButtonElement[] => [
      ...canvasElement.querySelectorAll<HTMLButtonElement>(".canvas-dots button")
    ]
    await waitFor(() => expect(dots()).toHaveLength(0))
    const divider = canvas.getByRole("separator")
    const start = divider.getBoundingClientRect()
    const x = start.left + start.width / 2
    const y = start.top + 100
    await userEvent.pointer({
      target: divider,
      keys: "[MouseLeft>]",
      coords: { clientX: x, clientY: y }
    })
    await userEvent.pointer({
      target: divider,
      coords: { clientX: x + 100, clientY: y }
    })
    await waitFor(() => expect(dots()).toHaveLength(2))
    await userEvent.pointer({
      target: divider,
      coords: { clientX: x, clientY: y }
    })
    await waitFor(() => expect(dots()).toHaveLength(0))
    await userEvent.pointer({ target: divider, keys: "[/MouseLeft]" })
    const panels = canvasElement.querySelectorAll<HTMLElement>(".file-workspace-slide")
    await expect(panels[0].getBoundingClientRect().width).toBeCloseTo(panels[1].getBoundingClientRect().width, 0)
    await expect(canvas.getByRole("textbox", { name: "Draft" })).toHaveValue("Preserved draft")
  }
}

export const StableOuterGutters: Story = {
  ...Unified,
  name: "外侧间距保持稳定",
  args: { ...Unified.args, initialPinned: false },
  globals: { locale: "en" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const body = canvasElement.querySelector<HTMLElement>(".main-window-body")!
    const dots = (): HTMLButtonElement[] => [
      ...canvasElement.querySelectorAll<HTMLButtonElement>(".canvas-dots button")
    ]
    const assertGutters = async (selector: string): Promise<void> => {
      await waitFor(
        async () => {
          const bounds = body.getBoundingClientRect()
          const panel = canvasElement.querySelector(selector)!.getBoundingClientRect()
          await expect(panel.left - bounds.left).toBeCloseTo(desktopDefaults.gutter * 1.5, 0)
          await expect(bounds.right - panel.right).toBeCloseTo(desktopDefaults.gutter * 1.5, 0)
        },
        { timeout: 3000 }
      )
    }
    await assertGutters(".file-workspace-chat")
    await userEvent.click(dots()[1])
    await assertGutters(".file-workspace-panel")
    await userEvent.click(canvas.getByRole("button", { name: "Return to chat" }))
    await assertGutters(".file-workspace-chat")
    await userEvent.click(canvas.getByRole("switch"))
    await userEvent.click(canvas.getByRole("switch"))
    await assertGutters(".file-workspace-chat")
    await userEvent.click(canvas.getByRole("button", { name: "Wide layout" }))
    await waitFor(() => expect(dots()).toHaveLength(0))
    await userEvent.click(canvas.getByRole("separator"))
    for (let i = 0; i < 11; i++) await userEvent.keyboard(i18n.dir() === "rtl" ? "{ArrowLeft}" : "{ArrowRight}")
    await waitFor(() => expect(dots()).toHaveLength(2))
    await assertGutters(".file-workspace-chat")
    await userEvent.click(dots()[1])
    await assertGutters(".file-workspace-panel")
    await userEvent.click(canvas.getByRole("button", { name: "Close preview" }))
    await assertGutters(".file-workspace-chat")
  }
}

export const StableOuterGuttersRtl: Story = {
  ...StableOuterGutters,
  name: "外侧间距保持稳定 · 从右向左",
  globals: { locale: "ar" }
}

export const NavigationDuringMotion: Story = {
  ...Unified,
  name: "动画过程中操作导航",
  args: { ...Unified.args, initialPinned: false },
  globals: { locale: "en" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const nav = canvasElement.querySelector<HTMLElement>(".main-sidebar-panel")!
    const track = canvasElement.querySelector<HTMLElement>(".main-screen-track")!
    const viewport = canvasElement.querySelector<HTMLElement>(".main-sidebar-viewport")!
    const dots = (): HTMLButtonElement[] => [
      ...canvasElement.querySelectorAll<HTMLButtonElement>(".canvas-dots button")
    ]
    await waitFor(() => expect(dots()).toHaveLength(2))
    const original = nav.getBoundingClientRect().left - track.getBoundingClientRect().left
    const panels = [...canvasElement.querySelectorAll<HTMLElement>(".file-workspace-slide")]
    const widths = panels.map((panel) => panel.getBoundingClientRect().width)
    await hoverNavigationEdge(canvasElement)
    await userEvent.click(await canvas.findByRole("button", { name: "Leading" }))
    for (let frame = 0; frame < 50; frame++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      await expect(getComputedStyle(viewport).visibility).toBe("visible")
      for (const panel of canvasElement.querySelectorAll<HTMLElement>("[data-screen-panel]"))
        await expect(getComputedStyle(panel).visibility).toBe("visible")
      for (const [index, panel] of panels.entries())
        await expect(panel.getBoundingClientRect().width).toBeCloseTo(widths[index], 3)
      await expect(nav.getBoundingClientRect().left - track.getBoundingClientRect().left).toBeCloseTo(original, 0)
    }
    await userEvent.click(dots()[0])
    for (let frame = 0; frame < 50; frame++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      await expect(getComputedStyle(viewport).visibility).toBe("visible")
      for (const panel of canvasElement.querySelectorAll<HTMLElement>("[data-screen-panel]"))
        await expect(getComputedStyle(panel).visibility).toBe("visible")
      for (const [index, panel] of panels.entries())
        await expect(panel.getBoundingClientRect().width).toBeCloseTo(widths[index], 3)
      await expect(nav.getBoundingClientRect().left - track.getBoundingClientRect().left).toBeCloseTo(original, 0)
    }
  }
}

export const NavigationDuringMotionPinned: Story = {
  ...NavigationDuringMotion,
  name: "动画过程中操作导航 · 固定侧栏",
  args: { ...Unified.args, initialPinned: true }
}
export const NavigationDuringMotionRtl: Story = {
  ...NavigationDuringMotion,
  name: "动画过程中操作导航 · 从右向左",
  globals: { locale: "ar" }
}

export const StablePanelGap: Story = {
  ...Unified,
  name: "面板间距保持稳定",
  globals: { locale: "en" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const assertGap = async (): Promise<void> => {
      const chat = canvasElement.querySelector(".file-workspace-chat")!.getBoundingClientRect()
      const preview = canvasElement.querySelector(".file-workspace-panel")!.getBoundingClientRect()
      const gap = i18n.dir() === "rtl" ? chat.left - preview.right : preview.left - chat.right
      await expect(gap).toBeCloseTo(desktopDefaults.gutter, 2)
    }
    await userEvent.click(canvas.getByRole("button", { name: "Wide layout" }))
    const dots = (): HTMLButtonElement[] => [
      ...canvasElement.querySelectorAll<HTMLButtonElement>(".canvas-dots button")
    ]
    await waitFor(() => expect(dots()).toHaveLength(0))
    await assertGap()
    await userEvent.click(canvas.getByRole("separator"))
    for (let i = 0; i < 11; i++) await userEvent.keyboard(i18n.dir() === "rtl" ? "{ArrowLeft}" : "{ArrowRight}")
    await waitFor(() => expect(dots()).toHaveLength(2))
    await assertGap()
    for (const index of [2, 1]) {
      if (index === 0) {
        await hoverNavigationEdge(canvasElement)
        await userEvent.click(await canvas.findByRole("button", { name: "Leading" }))
      } else if (canvasElement.querySelector('[data-main-screen="leading"]')) {
        await hoverNavigationEdge(canvasElement)
        await userEvent.click(await canvas.findByRole("button", { name: /^Chat$/ }))
      } else await userEvent.click(dots()[index - 1])
      for (let frame = 0; frame < 50; frame++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        await assertGap()
      }
    }
  }
}
export const StablePanelGapRtl: Story = {
  ...StablePanelGap,
  name: "面板间距保持稳定 · 从右向左",
  globals: { locale: "ar" }
}

export const MainControlsOnly: Story = {
  ...Unified,
  name: "仅显示主区域控制按钮",
  globals: { locale: "en" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const dots = (): HTMLButtonElement[] => [
      ...canvasElement.querySelectorAll<HTMLButtonElement>(".canvas-dots button")
    ]
    await waitFor(() => expect(dots()).toHaveLength(2))
    for (const index of [0, 1, 2, 1]) {
      if (index === 0) {
        await hoverNavigationEdge(canvasElement)
        await userEvent.click(await canvas.findByRole("button", { name: "Leading" }))
      } else if (canvasElement.querySelector('[data-main-screen="leading"]')) {
        await hoverNavigationEdge(canvasElement)
        await userEvent.click(await canvas.findByRole("button", { name: /^Chat$/ }))
      } else await userEvent.click(dots()[index - 1])
      await waitFor(async () => {
        if (index === 1) {
          await expect(canvas.getByRole("switch")).toBeVisible()
          await expect(canvas.getByRole("button", { name: "Open workspace" })).toBeVisible()
        } else {
          await expect(canvas.queryByRole("switch")).not.toBeInTheDocument()
          await expect(canvas.queryByRole("button", { name: "Open workspace" })).not.toBeInTheDocument()
        }
      })
    }
  }
}

export const DragLeftHidesChat: Story = {
  ...Unified,
  name: "向左拖动隐藏聊天",
  globals: { locale: "en" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Wide layout" }))
    const dots = (): HTMLButtonElement[] => [
      ...canvasElement.querySelectorAll<HTMLButtonElement>(".canvas-dots button")
    ]
    await waitFor(() => expect(dots()).toHaveLength(0))
    const divider = canvas.getByRole("separator")
    const rect = divider.getBoundingClientRect()
    const x = rect.left + rect.width / 2
    const y = rect.top + 100
    const dx = i18n.dir() === "rtl" ? 220 : -220
    await userEvent.pointer({ target: divider, keys: "[MouseLeft>]", coords: { clientX: x, clientY: y } })
    await userEvent.pointer({ target: divider, coords: { clientX: x + dx, clientY: y } })
    await waitFor(async () => {
      await expect(canvas.queryByRole("textbox", { name: "Draft" })).not.toBeInTheDocument()
      await expect(canvasElement.querySelector(".file-workspace-slide")!.getBoundingClientRect().width).toBe(0)
      await expect(dots()).toHaveLength(0)
    })
    await userEvent.pointer({ target: divider, coords: { clientX: x, clientY: y } })
    await waitFor(() => expect(canvas.getByRole("textbox", { name: "Draft" })).toHaveValue("Preserved draft"))
    await userEvent.pointer({ target: divider, coords: { clientX: x + dx, clientY: y } })
    await userEvent.pointer({ target: divider, keys: "[/MouseLeft]" })
    await userEvent.click(canvas.getByRole("button", { name: "Return to chat" }))
    await waitFor(() => expect(canvas.getByRole("textbox", { name: "Draft" })).toHaveValue("Preserved draft"))
  }
}
export const DragLeftHidesChatRtl: Story = {
  ...DragLeftHidesChat,
  name: "向左拖动隐藏聊天 · 从右向左",
  globals: { locale: "ar" }
}

export const RestoreAfterDragging: Story = {
  ...Unified,
  name: "拖动后恢复布局",
  parameters: { realPreviewControls: true },
  globals: { locale: "en" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Wide layout" }))
    const dots = (): HTMLButtonElement[] => [
      ...canvasElement.querySelectorAll<HTMLButtonElement>(".canvas-dots button")
    ]
    await waitFor(() => expect(dots()).toHaveLength(0))
    for (const delta of [-240, 100]) {
      const divider = canvas.getByRole("separator")
      const bounds = divider.getBoundingClientRect()
      const x = bounds.left + bounds.width / 2
      const y = bounds.top + 180
      await userEvent.pointer({ target: divider, keys: "[MouseLeft>]", coords: { clientX: x, clientY: y } })
      await userEvent.pointer({ target: divider, coords: { clientX: x + delta, clientY: y } })
      await userEvent.pointer({ target: divider, coords: { clientX: x + delta + Math.sign(delta) * 2, clientY: y } })
      await userEvent.pointer({ target: divider, keys: "[/MouseLeft]" })
      if (delta > 0) {
        await waitFor(() => expect(dots()).toHaveLength(2))
        await userEvent.click(dots()[1])
      }
      const restore = await canvas.findByRole("button", { name: "Restore" })
      await waitFor(() => expect(restore).toBeVisible())
      await expect(restore).toHaveAttribute("aria-pressed", "true")
      await userEvent.click(restore)
      await waitFor(
        async () => {
          await expect(dots()).toHaveLength(0)
          await expect(canvas.getByRole("button", { name: "Maximize" })).toBeVisible()
          await expect(canvas.getByRole("textbox", { name: "Draft" })).toHaveValue("Preserved draft")
          const chat = canvasElement.querySelector(".file-workspace-chat")!.getBoundingClientRect()
          const preview = canvasElement.querySelector(".file-workspace-panel")!.getBoundingClientRect()
          await expect(chat.width).toBeGreaterThan(320)
          await expect(preview.left - chat.right).toBeCloseTo(desktopDefaults.gutter, 1)
          await expect(preview.right).toBeLessThanOrEqual(
            canvasElement.querySelector(".main-window-body")!.getBoundingClientRect().right
          )
        },
        { timeout: 3000 }
      )
      await expect(canvas.getByRole("textbox", { name: "Editor draft" })).toHaveValue("Preserved edit")
    }
  }
}

export const TitlebarRestoreThenClose: Story = {
  ...Unified,
  name: "标题栏恢复后关闭",
  parameters: { realPreviewControls: true, titlebarToggle: true },
  globals: { locale: "en" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Wide layout" }))
    const dots = (): HTMLButtonElement[] => [
      ...canvasElement.querySelectorAll<HTMLButtonElement>(".canvas-dots button")
    ]
    await waitFor(() => expect(dots()).toHaveLength(0))
    const divider = canvas.getByRole("separator", { name: "Resize workspace" })
    await userEvent.click(divider)
    for (let i = 0; i < 5; i++) await userEvent.keyboard("{ArrowRight}")
    await waitFor(() => expect(dots()).toHaveLength(2))
    await userEvent.click(dots()[1])
    await waitFor(() => expect(canvas.getByRole("button", { name: "Restore" })).toBeVisible())
    await userEvent.click(dots()[0])
    await userEvent.click(await canvas.findByRole("button", { name: "Close workspace" }))
    await waitFor(
      async () => {
        await expect(dots()).toHaveLength(0)
        await expect(canvas.getByRole("button", { name: "Maximize" })).toBeVisible()
        await expect(canvas.getByRole("textbox", { name: "Draft" })).toHaveValue("Preserved draft")
        const chat = canvasElement.querySelector(".file-workspace-chat")!.getBoundingClientRect()
        const preview = canvasElement.querySelector(".file-workspace-panel")!.getBoundingClientRect()
        await expect(chat.width).toBeGreaterThan(320)
        await expect(preview.left - chat.right).toBeCloseTo(desktopDefaults.gutter, 1)
      },
      { timeout: 3000 }
    )
    await expect(canvas.getByRole("textbox", { name: "Editor draft" })).toHaveValue("Preserved edit")
    await userEvent.click(canvas.getByRole("button", { name: "Close workspace" }))
    await waitFor(() =>
      expect(canvasElement.querySelector(".file-workspace-layout")).toHaveAttribute("data-open", "false")
    )
    await expect(canvas.getByRole("button", { name: "Open workspace" })).toBeVisible()
    await expect(canvas.getByRole("textbox", { name: "Draft" })).toHaveValue("Preserved draft")
  }
}

export const ThreeScreenTransitions: Story = {
  ...Unified,
  name: "三个区域之间切换",
  parameters: { realPreviewControls: true, titlebarToggle: true, externalActions: true },
  globals: { locale: "en" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const dots = (): HTMLButtonElement[] => [
      ...canvasElement.querySelectorAll<HTMLButtonElement>(".canvas-dots button")
    ]
    const host = canvasElement.querySelector<HTMLElement>("[data-main-screen]")!
    const settled = async (index: number, count: number): Promise<void> => {
      await waitFor(
        async () => {
          await expect(dots()).toHaveLength(index > 0 && count > 2 ? count - 1 : 0)
          if (index > 0 && dots().length > 0) await expect(dots()[index - 1]).toHaveAttribute("aria-current", "page")
          await expect(host).toHaveAttribute("data-main-screen", index === 0 ? "leading" : "main")
          await expect(host).toHaveAttribute("data-canvas-moving", "false")
          await expect(canvas.queryByRole("switch") !== null).toBe(index === 1)
        },
        { timeout: 3000 }
      )
    }
    await settled(1, 3)
    await userEvent.type(canvas.getByRole("textbox", { name: "Draft" }), " / retained")
    await userEvent.click(dots()[1])
    await settled(2, 3)
    await hoverNavigationEdge(canvasElement)
    await userEvent.click(await canvas.findByRole("button", { name: "Leading" }))
    await settled(0, 3)
    // Changing geometry while on -1 must preserve that screen, even when preview's snap disappears.
    await userEvent.click(canvas.getByRole("button", { name: "Wide layout" }))
    await settled(0, 2)
    await userEvent.click(canvas.getByRole("button", { name: "Narrow layout" }))
    await settled(0, 3)
    await userEvent.click(canvas.getByRole("button", { name: "Close externally" }))
    await settled(0, 2)
    await userEvent.click(canvas.getByRole("button", { name: "Chat" }))
    await settled(1, 2)
    await expect(canvas.getByRole("textbox", { name: "Draft" })).toHaveValue("Preserved draft / retained")
    await userEvent.click(canvas.getByRole("button", { name: "Open workspace" }))
    await settled(2, 3)
    // Removing the current preview screen must land on main, with a valid dot and toolbar.
    await userEvent.click(canvas.getByRole("button", { name: "Close externally" }))
    await settled(1, 2)
    await userEvent.click(canvas.getByRole("button", { name: "Open workspace" }))
    await settled(2, 3)
    await userEvent.click(dots()[0])
    await settled(1, 3)
    await userEvent.click(canvas.getByRole("switch"))
    await hoverNavigationEdge(canvasElement)
    await userEvent.click(await canvas.findByRole("button", { name: "Leading" }))
    await settled(0, 3)
    await hoverNavigationEdge(canvasElement)
    await userEvent.click(await canvas.findByRole("button", { name: "Chat" }))
    await settled(1, 3)
    await expect(host).toHaveAttribute("data-canvas-pinned", "false")
    await expect(host).toHaveAttribute("data-sidebar-mode", "hidden")
    await userEvent.click(canvas.getByRole("button", { name: "Wide layout" }))
    await settled(1, 2)
    const draft = canvas.getByRole("textbox", { name: "Draft" })
    await userEvent.click(canvas.getByRole("separator", { name: i18n.t("workspace.resize") }))
    for (let i = 0; i < 11; i++) await userEvent.keyboard(i18n.dir() === "rtl" ? "{ArrowLeft}" : "{ArrowRight}")
    await settled(1, 3)
    await userEvent.click(dots()[1])
    await settled(2, 3)
    await userEvent.click(canvas.getByRole("button", { name: i18n.t("workspace.exitViewMode") }))
    await settled(1, 2)
    await expect(canvas.getByRole("textbox", { name: "Draft" })).toBe(draft)
    await expect(draft).toHaveValue("Preserved draft / retained")
    await expect(canvas.getByRole("textbox", { name: "Editor draft" })).toHaveValue("Preserved edit")
    await userEvent.click(canvas.getByRole("button", { name: "Close workspace" }))
    await settled(1, 2)
    await expect(canvasElement.querySelector(".file-workspace-layout")).toHaveAttribute("data-open", "false")
  }
}
export const ThreeScreenTransitionsRtl: Story = {
  ...ThreeScreenTransitions,
  name: "三个区域之间切换 · 从右向左",
  globals: { locale: "ar" }
}

export const SplitFromMainStaysOnMain: Story = {
  ...Unified,
  name: "从主区域分栏后保持主区域",
  globals: { locale: "en" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const dots = (): HTMLButtonElement[] => [
      ...canvasElement.querySelectorAll<HTMLButtonElement>(".canvas-dots button")
    ]
    const host = canvasElement.querySelector<HTMLElement>("[data-canvas-moving]")!
    await waitFor(() => expect(dots()).toHaveLength(2))
    // Preview intent survives merging into the shared main screen; manual resizing must supersede it.
    await userEvent.click(dots()[1])
    await waitFor(() => expect(host).toHaveAttribute("data-canvas-moving", "false"), { timeout: 3000 })
    await userEvent.click(canvas.getByRole("button", { name: "Wide layout" }))
    await waitFor(async () => {
      await expect(dots()).toHaveLength(0)
      await expect(host).toHaveAttribute("data-main-screen", "main")
    })
    const divider = canvas.getByRole("separator")
    const bounds = divider.getBoundingClientRect()
    const x = bounds.left + bounds.width / 2
    const y = bounds.top + 150
    const dx = i18n.dir() === "rtl" ? -100 : 100
    await userEvent.pointer({ target: divider, keys: "[MouseLeft>]", coords: { clientX: x, clientY: y } })
    await userEvent.pointer({ target: divider, coords: { clientX: x + dx, clientY: y } })
    await userEvent.pointer({ target: divider, keys: "[/MouseLeft]" })
    await waitFor(
      async () => {
        await expect(dots()).toHaveLength(2)
        await expect(dots()[0]).toHaveAttribute("aria-current", "page")
        await expect(host).toHaveAttribute("data-canvas-moving", "false")
      },
      { timeout: 3000 }
    )
    for (let frame = 0; frame < 30; frame++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      await expect(dots()[0]).toHaveAttribute("aria-current", "page")
      const chat = canvasElement.querySelector(".file-workspace-chat")!.getBoundingClientRect()
      const body = canvasElement.querySelector(".main-window-body")!.getBoundingClientRect()
      await expect(chat.left).toBeGreaterThanOrEqual(body.left)
      await expect(chat.right).toBeLessThanOrEqual(body.right)
    }
    await expect(canvas.getByRole("textbox", { name: "Draft" })).toHaveValue("Preserved draft")
    await userEvent.click(dots()[1])
    await waitFor(() => expect(dots()[1]).toHaveAttribute("aria-current", "page"))
    await expect(canvas.getByRole("heading", { name: "Preview pane" })).toBeInTheDocument()
  }
}
export const SplitFromMainStaysOnMainRtl: Story = {
  ...SplitFromMainStaysOnMain,
  name: "从主区域分栏后保持主区域 · 从右向左",
  globals: { locale: "ar" }
}
