import type { Meta, StoryObj } from "@storybook/react-vite"

import { GuidePage } from "../../src/features/guide/guide-page"

const meta = {
  title: "Guide/Handbook",
  component: GuidePage,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="fixed inset-0">
        <Story />
      </div>
    )
  ]
} satisfies Meta<typeof GuidePage>
export default meta
type Story = StoryObj<typeof meta>

export const Light: Story = { globals: { theme: "light", locale: "en" } }
export const Dark: Story = { globals: { theme: "dark", locale: "en" } }
