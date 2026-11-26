import type { Loader } from "@storybook/react-vite"
import type { ComponentProps } from "react"
import { expect, waitFor } from "storybook/test"

import { pendingAction } from "../../fixtures/catalog"
import { actionsTaken, client } from "../../fixtures/client"
import { preparePreview } from "../../fixtures/prepare"
import preview from "../../preview"
import type { SharedMeta, SharedPlay } from "../page-meta"
import { ProductPreview } from "../product-preview"

export const pageMeta = {
  tags: ["layout"],
  args: { page: "chat", chatCase: "permission" },
  loaders: [preparePreview],
  parameters: { layout: "fullscreen", productPage: true, a11y: { test: "todo" } }
} satisfies SharedMeta<ComponentProps<typeof ProductPreview>>

// pageMeta is shared with derived files, not a story.
const meta = preview.meta({
  id: "chat-request-overflow",
  title: "页面/主窗聊天/长请求滚动",
  excludeStories: ["pageMeta"],
  component: ProductPreview,
  ...pageMeta
})
type Play = SharedPlay<ComponentProps<typeof ProductPreview>>

const longRequest = (count: number, command: boolean): Loader<ComponentProps<typeof ProductPreview>>[] => [
  () => {
    const action = pendingAction("permission", "permission")
    if (action.kind !== "permission") throw new Error("Expected a permission request")
    action.params.title = "Run command?"
    action.params.description = command
      ? "Review the complete command before choosing an option."
      : "Long approval explanation. ".repeat(300)
    action.params.subject = {
      type: "tool_call",
      toolCall: {
        toolCallId: "long-command",
        title: "Run command?",
        kind: "execute",
        status: "pending",
        rawInput: {
          command: Array.from({ length: 150 }, (_, i) => `print("Review line ${i}: ${"x".repeat(180)}")`).join("\n")
        }
      }
    }
    client.store.setState({ actions: Array.from({ length: count }, (_, i) => ({ ...action, id: `overflow-${i}` })) })
  }
]

const verifyScrolling: Play = async ({ canvasElement, userEvent }) => {
  if (!import.meta.env.STORYBOOK_TEST) return
  const requests = canvasElement.querySelector<HTMLElement>("[data-session-actions]")!
  const content = canvasElement.querySelector<HTMLElement>("[data-chat-content]")!
  const composer = content.querySelector<HTMLElement>("[data-chat-input]")!.closest("form")!
  const cards = [...requests.querySelectorAll<HTMLElement>('[data-overlay="permission-request"]')]
  const lastRequestId = client.state.actions.at(-1)!.id
  await waitFor(async () => {
    await expect(requests.getBoundingClientRect().height).toBeLessThanOrEqual(content.clientHeight / 2 + 1)
    await expect(composer.getBoundingClientRect().top).toBeGreaterThanOrEqual(requests.getBoundingClientRect().bottom)
    await expect(composer.getBoundingClientRect().bottom).toBeLessThanOrEqual(content.getBoundingClientRect().bottom)
  })
  if (cards.length === 1) await expect(requests.scrollHeight).toBeLessThanOrEqual(requests.clientHeight + 1)

  for (const card of cards) {
    const body = card.querySelector<HTMLElement>("[data-permission-content]")
    await expect(body).not.toBeNull()
    const header = card.querySelector<HTMLElement>("[data-permission-header]")!
    const options = card.querySelector<HTMLElement>('[role="listbox"]')!
    card.scrollIntoView({ block: "end" })
    await waitFor(async () => {
      await expect(body!.clientHeight).toBeGreaterThan(0)
      await expect(body!.scrollHeight).toBeGreaterThan(body!.clientHeight)
      await expect(header.getBoundingClientRect().top).toBeGreaterThanOrEqual(requests.getBoundingClientRect().top)
      await expect(header.getBoundingClientRect().bottom).toBeLessThanOrEqual(body!.getBoundingClientRect().top + 1)
      await expect(options.getBoundingClientRect().top).toBeGreaterThanOrEqual(body!.getBoundingClientRect().bottom - 1)
      await expect(options.getBoundingClientRect().bottom).toBeLessThanOrEqual(requests.getBoundingClientRect().bottom)
    })
    const headerTop = header.getBoundingClientRect().top
    const optionsTop = options.getBoundingClientRect().top
    const outerScroll = requests.scrollTop
    body!.scrollTop = body!.scrollHeight
    await waitFor(async () => {
      await expect(body!.scrollTop).toBeGreaterThan(0)
      await expect(header.getBoundingClientRect().top).toBe(headerTop)
      await expect(options.getBoundingClientRect().top).toBe(optionsTop)
      await expect(requests.scrollTop).toBe(outerScroll)
    })
  }
  const reject = cards.at(-1)!.querySelectorAll<HTMLElement>('[role="option"]')
  await userEvent.click(reject[reject.length - 1])
  await expect(actionsTaken).toContainEqual({
    type: "respond",
    id: lastRequestId,
    value: { outcome: { outcome: "selected", optionId: "reject_once" } }
  })
}

export const LongCommand = meta.story({ name: "长命令授权", loaders: longRequest(1, true), play: verifyScrolling })
export const LongExplanation = meta.story({
  name: "长说明与命令",
  loaders: longRequest(1, false),
  play: verifyScrolling
})
export const MultipleRequests = meta.story({
  name: "多条长请求",
  loaders: longRequest(3, false),
  play: verifyScrolling
})
export const CompactWindow = meta.story({
  name: "矮窗口长命令",
  args: { height: 480, width: 760 },
  loaders: longRequest(1, true),
  play: verifyScrolling
})
export const CompactMultiple = meta.story({
  name: "矮窗口多条请求",
  args: { height: 480, width: 760 },
  loaders: longRequest(3, false),
  play: verifyScrolling
})
