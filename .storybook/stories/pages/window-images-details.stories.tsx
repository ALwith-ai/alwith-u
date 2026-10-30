import { CodexActivityGroup } from "@alwith/module-chat/activity"
import { type ActivityHost, ActivityHostProvider } from "@alwith/module-chat/activity-host"
import type { ToolUseBlock } from "@alwith/module-chat/group-blocks"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { useEffect } from "react"
import { expect, waitFor, within } from "storybook/test"

import { Button } from "../../../src/components/ui/button"
import { ImageLightbox, openImageGallery, openImageLightbox } from "../../../src/features/chat/dialogs/image-lightbox"
import { preventVibemonImageDragging } from "../../../src/features/vibemon/image-drag"
import i18n from "../../../src/lib/i18n"

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

const meta = {
  id: "页面-辅助窗口-窗口图标",
  globals: { locale: "en" },
  title: "页面/其他/辅助窗口/窗口图标",
  component: ImagePreviewExample
} satisfies Meta<typeof ImagePreviewExample>
export default meta
type Story = StoryObj<typeof meta>

export const PreviewCloseButton: Story = {
  name: "预览关闭按钮",
  play: async ({ canvasElement, canvas, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(canvas.getByRole("button", { name: "Preview image" }))
    const dialog = await body.findByRole("dialog")
    const close = within(dialog).getByRole("button", { name: "Close" })
    await waitFor(() => {
      expect(close.getBoundingClientRect().width).toBe(32)
      expect(close.getBoundingClientRect().height).toBe(32)
      expect(getComputedStyle(close).borderRadius).toBe("8px")
      expect(close.getBoundingClientRect().top).toBe(16)
      expect(canvasElement.ownerDocument.defaultView!.innerWidth - close.getBoundingClientRect().right).toBe(16)
      expect(getComputedStyle(close).cursor).toBe("pointer")
      expect(getComputedStyle(close).backgroundColor).toBe("rgba(0, 0, 0, 0)")
      expect(close.querySelector("svg")!.getBoundingClientRect().width).toBe(16)
    })
    await userEvent.hover(close)
    await waitFor(() => expect(getComputedStyle(close).backgroundColor).toBe("rgba(0, 0, 0, 0)"))
    await userEvent.click(close)
    await waitFor(() => expect(body.queryByRole("dialog")).toBeNull())
    await userEvent.click(canvas.getByRole("button", { name: "Preview image" }))
    await userEvent.keyboard("{Escape}")
    await waitFor(() => expect(body.queryByRole("dialog")).toBeNull())
  }
}

export const PetImagesDoNotDrag: Story = {
  name: "宠物图片禁止拖动",
  render: () => <PetImageExample />,
  play: async ({ canvas }) => {
    const image = canvas.getByRole("img", { name: "Pet image" })
    await waitFor(() => expect(getComputedStyle(image).getPropertyValue("-webkit-user-drag")).toBe("none"))
    expect(image.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true }))).toBe(false)
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
  name: "图片预览画廊",
  render: () => <ImageActivityExample />,
  play: async ({ canvasElement, canvas, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(canvas.getByRole("button", { name: "Viewed 12 images" }))
    await waitFor(() => expect(canvas.getAllByRole("img")).toHaveLength(12))
    const thumbnail = canvas.getAllByRole("img")[0]!
    expect(thumbnail.getBoundingClientRect().width).toBe(80)
    expect(thumbnail.getBoundingClientRect().height).toBe(80)
    const strip = thumbnail.closest(".codex-image-thumbnails")!
    expect(strip.scrollWidth).toBeGreaterThan(strip.clientWidth)
    await userEvent.click(canvas.getByRole("button", { name: "screenshot-0.png" }))
    const dialog = await body.findByRole("dialog")
    await userEvent.click(within(dialog).getByRole("button", { name: "Next image" }))
    expect(within(dialog).getByRole("img")).toHaveAttribute("alt", "screenshot-1.png")
    await userEvent.keyboard("{ArrowLeft}")
    expect(within(dialog).getByRole("img")).toHaveAttribute("alt", "screenshot-0.png")
    await userEvent.keyboard("{Escape}")
    await waitFor(() => expect(body.queryByRole("dialog")).toBeNull())
  }
}
