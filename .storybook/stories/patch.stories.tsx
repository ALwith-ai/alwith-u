import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect } from "storybook/test"
import { PatchView } from "../../src/features/chat/codex/patch-view"

const meta = { title: "Chat/Patch", component: PatchView } satisfies Meta<typeof PatchView>
export default meta
type Story = StoryObj<typeof meta>

export const FileEdit: Story = {
  args: {
    patch:
      "diff --git a/src/greeting.ts b/src/greeting.ts\n--- a/src/greeting.ts\n+++ b/src/greeting.ts\n@@ -1 +1 @@\n-export const greeting = 'Hello'\n+export const greeting = 'Hello, ALwith U'\n"
  },
  play: async ({ canvasElement }) => {
    await expect(canvasElement).toHaveTextContent("ALwith U")
  }
}
export const Dark: Story = { ...FileEdit, globals: { theme: "dark" } }
