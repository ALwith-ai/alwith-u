import type { Meta, StoryObj } from "@storybook/react-vite"
import { fn } from "storybook/test"
import { ComputerPreviewCard } from "../../src/features/computer/preview-card"
const image = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#faf9f6"/><rect width="800" height="42" fill="#eeece7"/><text x="24" y="27" font-size="14" fill="#666">Notes — Project ideas</text><text x="80" y="130" font-size="30" fill="#252525">A little more space to think.</text><text x="80" y="185" font-size="18" fill="#666">Gather ideas. Make something useful.</text><path d="M80 220H650 M80 260H570 M80 300H610" stroke="#ddd" stroke-width="6"/></svg>')}`
const meta = {
  title: "Chat/Computer preview",
  component: ComputerPreviewCard,
  parameters: { layout: "centered" },
  args: {
    stopping: false,
    onStop: fn(),
    onFocus: fn(),
    preview: {
      subscriptionId: "story",
      activity: {
        sessionId: "story",
        phase: "active",
        queuePosition: 0,
        ownerSessionId: "story",
        action: "type_text",
        target: { pid: 1, windowId: 2 },
        revision: 1
      },
      frame: { image, title: "Project ideas", appName: "Notes", cursor: { x: 0.42, y: 0.35 } },
      error: null
    }
  },
  decorators: [
    Story => (
      <div style={{ width: 600 }}>
        <Story />
      </div>
    )
  ]
} satisfies Meta<typeof ComputerPreviewCard>
export default meta
type Story = StoryObj<typeof meta>
export const Active: Story = {}
export const Queued: Story = {
  args: {
    preview: {
      ...meta.args.preview,
      frame: null,
      activity: { ...meta.args.preview.activity, phase: "queued", queuePosition: 2 }
    }
  }
}
export const Waiting: Story = { args: { preview: { ...meta.args.preview, frame: null } } }
