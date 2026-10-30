import type { StoryObj } from "@storybook/react-vite"
import { expect, waitFor } from "storybook/test"

import type { ProductPreview } from "./product-preview"

// Only source content disclosures: never menus, permissions, dialogs, or file actions.
const collapsedChatDetails = [
  '.codex-work-section button[data-codex-disclosure][aria-expanded="false"]:not(:disabled)',
  '.codex-work-section .codex-activity-group-trigger[aria-expanded="false"]',
  '.codex-edited-files-card button[data-codex-disclosure][aria-expanded="false"]',
  '.codex-edited-files-more[aria-expanded="false"]'
].join(",")

export const expandChatDetails: NonNullable<StoryObj<typeof ProductPreview>["play"]> = async ({
  canvasElement,
  userEvent
}) => {
  await waitFor(() => expect(canvasElement.querySelector("[data-chat-content]")).toBeVisible())
  const opened = new Set<HTMLButtonElement>()
  for (;;) {
    const button = canvasElement.querySelector<HTMLButtonElement>(collapsedChatDetails)
    if (!button) break
    if (opened.has(button)) throw new Error("A chat preview disclosure closed while preparing its content")
    opened.add(button)
    await userEvent.click(button)
    await waitFor(() => expect(button).toHaveAttribute("aria-expanded", "true"))
    button.blur()
  }
  await expect(canvasElement.querySelectorAll(collapsedChatDetails)).toHaveLength(0)
}
