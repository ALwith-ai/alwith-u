import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, waitFor } from "storybook/test"

import { NavigationAds } from "../../src/features/layout/components/navigation-ads"

const meta = {
  title: "Layout/Navigation ads",
  component: NavigationAds,
  args: { onOpenVibemon: () => {} },
  decorators: [
    (Story) => (
      <div style={{ width: 256, padding: 4 }}>
        <Story />
      </div>
    )
  ]
} satisfies Meta<typeof NavigationAds>
export default meta
type Story = StoryObj<typeof meta>

export const EqualGutters: Story = {
  play: async ({ canvasElement, userEvent }) => {
    const viewport = canvasElement.querySelector<HTMLElement>('[data-slot="navigation-ads"]')!
    const buttons = [...viewport.querySelectorAll("button")]
    await userEvent.hover(viewport)
    const check = async (index: number) => {
      await waitFor(() => {
        const bounds = viewport.getBoundingClientRect()
        const slide = buttons[index].getBoundingClientRect()
        void expect(slide.left).toBeCloseTo(bounds.left, 0)
        void expect(slide.right).toBeCloseTo(bounds.right, 0)
        void expect(slide.height).toBeCloseTo(bounds.height, 0)
        void expect(slide.width / slide.height).toBeCloseTo(16 / 5, 1)
      })
    }
    await check(0)
    buttons[0].focus()
    await userEvent.keyboard("{ArrowRight}")
    await check(1)
    await userEvent.keyboard("{ArrowRight}")
    await check(0)
  }
}
