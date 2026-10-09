import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, waitFor } from "storybook/test"
import { MainSidebarLayout } from "../../src/features/layout/components/main-sidebar-layout"

const meta = {
  title: "Layout/Direction",
  component: MainSidebarLayout,
  args: {
    initialPinned: true,
    screen: "main",
    sidebar: (
      <div className="p-8" data-testid="navigation">
        Navigation
      </div>
    ),
    main: <div className="p-8">Chat</div>,
    leading: <div className="p-8">Activity</div>
  }
} satisfies Meta<typeof MainSidebarLayout>
export default meta
type Story = StoryObj<typeof meta>

export const English: Story = {
  globals: { locale: "en" },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const sidebar = canvasElement.querySelector(".main-sidebar-panel")!
      const main = canvasElement.querySelector('[data-screen-panel="main"]')!
      expect(sidebar.getBoundingClientRect().right).toBeCloseTo(main.getBoundingClientRect().left, 0)
      expect(getComputedStyle(main).direction).toBe("ltr")
    })
  }
}

export const Arabic: Story = {
  globals: { locale: "ar" },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const sidebar = canvasElement.querySelector(".main-sidebar-panel")!
      const main = canvasElement.querySelector('[data-screen-panel="main"]')!
      const viewport = canvasElement.querySelector('[data-slot="sidebar-wrapper"]')!
      expect(getComputedStyle(main).direction).toBe("rtl")
      expect(sidebar.getBoundingClientRect().left).toBeCloseTo(main.getBoundingClientRect().right, 0)
      expect(sidebar.getBoundingClientRect().right).toBeCloseTo(viewport.getBoundingClientRect().right, 0)
      expect(main.getBoundingClientRect().left).toBeCloseTo(viewport.getBoundingClientRect().left, 0)
    })
  }
}

export const ArabicActivity: Story = {
  args: { screen: "leading" },
  globals: { locale: "ar" },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const sidebar = canvasElement.querySelector(".main-sidebar-panel")!
      const leading = canvasElement.querySelector('[data-screen-panel="leading"]')!
      expect(sidebar.getBoundingClientRect().right).toBeCloseTo(leading.getBoundingClientRect().left, 0)
      expect(getComputedStyle(leading).direction).toBe("rtl")
    })
  }
}

export const ArabicFloatingSidebar: Story = {
  args: { initialPinned: false },
  globals: { locale: "ar" },
  play: async ({ canvasElement, userEvent }) => {
    const toggle = canvasElement.querySelector<HTMLButtonElement>(".main-sidebar-toggle button")!
    await userEvent.hover(toggle)
    await waitFor(() => {
      const sidebar = canvasElement.querySelector(".main-sidebar-panel")!
      const viewport = canvasElement.querySelector('[data-slot="sidebar-wrapper"]')!
      expect(viewport.getAttribute("data-sidebar-mode")).toBe("floating")
      expect(sidebar.getBoundingClientRect().right).toBeCloseTo(viewport.getBoundingClientRect().right, 0)
      expect(getComputedStyle(sidebar).visibility).toBe("visible")
    })
  }
}
