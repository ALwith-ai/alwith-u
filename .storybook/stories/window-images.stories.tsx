import { CodexActivityGroup } from "@alwith/module-chat/activity"
import { type ActivityHost, ActivityHostProvider } from "@alwith/module-chat/activity-host"
import type { ToolUseBlock } from "@alwith/module-chat/group-blocks"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { useEffect } from "react"
import { expect, waitFor, within } from "storybook/test"

import { Button } from "../../src/components/ui/button"
import { ImageLightbox, openImageGallery, openImageLightbox } from "../../src/features/chat/dialogs/image-lightbox"
import { preventVibemonImageDragging } from "../../src/features/vibemon/image-drag"
import i18n from "../../src/lib/i18n"

const image = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180">
    <rect width="320" height="180" fill="#888"/>
  </svg>`
)}`

function ImagePreviewExample() {
  return (
    <>
      <Button onClick={() => openImageLightbox(image, "Preview image")}>Preview image</Button>
      <ImageLightbox />
    </>
  )
}

function PetImageExample() {
  useEffect(() => preventVibemonImageDragging(), [])
  return <img src={image} alt="Pet image" />
}

const meta = { title: "Windows/Images", component: ImagePreviewExample } satisfies Meta<typeof ImagePreviewExample>
export default meta
type Story = StoryObj<typeof meta>

export const PreviewCloseButton: Story = {
  play: async ({ canvasElement, canvas, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(canvas.getByRole("button", { name: "Preview image" }))
    const dialog = await body.findByRole("dialog")
    const close = within(dialog).getByRole("button", { name: "Close" })
    await waitFor(async () => {
      await expect(close.getBoundingClientRect().width).toBe(32)
      await expect(close.getBoundingClientRect().height).toBe(32)
      await expect(getComputedStyle(close).borderRadius).toBe("8px")
      await expect(close.getBoundingClientRect().top).toBe(16)
      await expect(canvasElement.ownerDocument.defaultView!.innerWidth - close.getBoundingClientRect().right).toBe(16)
      await expect(getComputedStyle(close).cursor).toBe("pointer")
      await expect(getComputedStyle(close).backgroundColor).toBe("rgba(0, 0, 0, 0)")
      await expect(close.querySelector("svg")!.getBoundingClientRect().width).toBe(16)
    })
    await userEvent.hover(close)
    await waitFor(async () => expect(getComputedStyle(close).backgroundColor).not.toBe("rgba(0, 0, 0, 0)"))
    await userEvent.click(close)
    await waitFor(async () => expect(body.queryByRole("dialog")).toBeNull())
    await userEvent.click(canvas.getByRole("button", { name: "Preview image" }))
    await userEvent.keyboard("{Escape}")
    await waitFor(async () => expect(body.queryByRole("dialog")).toBeNull())
  }
}

export const PetImagesDoNotDrag: Story = {
  render: () => <PetImageExample />,
  play: async ({ canvas }) => {
    const image = canvas.getByRole("img", { name: "Pet image" })
    await waitFor(async () => expect(getComputedStyle(image).getPropertyValue("-webkit-user-drag")).toBe("none"))
    await expect(image.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true }))).toBe(false)
  }
}

function ImageActivityExample() {
  const host: ActivityHost = {
    t: (key, values) => i18n.t(key, { ...values, ns: "alwithChat" }),
    i18n: { language: i18n.language },
    openLink: () => {},
    Markdown: ({ text }) => <p>{text}</p>,
    loadImage: async () => image,
    openImageGallery
  }
  const blocks: ToolUseBlock[] = Array.from({ length: 12 }, (_, index) => ({
    type: "tool_use",
    id: `gallery-${index}`,
    name: "view_image",
    title: `View image screenshot-${index}.png`,
    kind: "read",
    status: "completed",
    content: [],
    locations: [],
    rawInput: { path: `/tmp/screenshot-${index}.png` },
    rawOutput: null
  }))
  return (
    <>
      <ActivityHostProvider host={host}>
        <CodexActivityGroup blocks={blocks} />
      </ActivityHostProvider>
      <ImageLightbox />
    </>
  )
}

export const ImageViewGallery: Story = {
  render: () => <ImageActivityExample />,
  play: async ({ canvasElement, canvas, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(canvas.getByRole("button", { name: "Viewed 12 images" }))
    await waitFor(async () => expect(canvas.getAllByRole("img")).toHaveLength(12))
    const thumbnail = canvas.getAllByRole("img")[0]!
    await expect(thumbnail.getBoundingClientRect().width).toBe(80)
    await expect(thumbnail.getBoundingClientRect().height).toBe(80)
    const strip = thumbnail.closest(".codex-image-thumbnails")!
    await expect(strip.scrollWidth).toBeGreaterThan(strip.clientWidth)
    await userEvent.click(canvas.getByRole("button", { name: "screenshot-0.png" }))
    const dialog = await body.findByRole("dialog")
    await userEvent.click(within(dialog).getByRole("button", { name: "Next image" }))
    await expect(within(dialog).getByRole("img")).toHaveAttribute("alt", "screenshot-1.png")
    await userEvent.keyboard("{ArrowLeft}")
    await expect(within(dialog).getByRole("img")).toHaveAttribute("alt", "screenshot-0.png")
    await userEvent.keyboard("{Escape}")
    await waitFor(async () => expect(body.queryByRole("dialog")).toBeNull())
  }
}
