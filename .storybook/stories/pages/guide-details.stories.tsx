import type { Meta, StoryObj } from "@storybook/react-vite"

import { GuidePage } from "../../../src/features/guide/guide-page"

const meta = {
  id: "页面-辅助窗口-指南细节",
  globals: { locale: "en" },
  title: "页面/其他/辅助窗口/指南细节",
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

export const Default: Story = { name: "使用指南" }
