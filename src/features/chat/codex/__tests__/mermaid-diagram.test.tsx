import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, expect, test, vi } from "vitest"
import { toast } from "sonner"
import { downloadChatFile } from "../../file-actions"
import { MermaidDiagram } from "../mermaid-diagram"
import { diagramPng } from "../mermaid-export"

vi.mock("@/components/theme-provider", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }))
vi.mock("../../file-actions", () => ({ downloadChatFile: vi.fn() }))
vi.mock("../mermaid-export", async importOriginal => ({
  ...(await importOriginal<typeof import("../mermaid-export")>()),
  diagramPng: vi.fn()
}))
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 320"></svg>' }))
  }
}))

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    getImageData: () => ({ data: new Uint8ClampedArray([128, 128, 128, 255]) })
  } as unknown as CanvasRenderingContext2D)
  vi.mocked(diagramPng).mockResolvedValue("cG5n")
  vi.mocked(downloadChatFile).mockResolvedValue(true)
})

test("opens the original SVG at 100% without rasterizing and keeps source switching available", async () => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1280)
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(640)
  render(<MermaidDiagram source="graph TD; A-->B" />)
  await waitFor(() => expect(screen.getByRole("button", { name: "放大图表" })).toBeEnabled())
  expect(screen.getAllByRole("button")).toHaveLength(2)
  fireEvent.click(screen.getByRole("button", { name: "放大图表" }))
  const dialog = await screen.findByRole("dialog", { name: "Mermaid 图表" })
  expect(within(dialog).getByRole("img", { name: "Mermaid 图表" })).toHaveAttribute(
    "src",
    expect.stringContaining("data:image/svg+xml")
  )
  expect(within(dialog).getByRole("img", { name: "Mermaid 图表" })).toHaveStyle({ width: "640px", height: "320px" })
  expect(within(dialog).getByRole("button", { name: "恢复原始尺寸" })).toHaveTextContent("100%")
  expect(diagramPng).not.toHaveBeenCalled()
  fireEvent.click(within(dialog).getByRole("button", { name: "关闭预览" }))
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  fireEvent.click(screen.getByRole("button", { name: "图表选项" }))
  fireEvent.click(await screen.findByRole("menuitem", { name: "查看源码" }))
  expect(screen.getByText("graph TD; A-->B")).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "图表选项" }))
  expect(await screen.findByRole("menuitem", { name: "下载 PNG" })).not.toHaveAttribute("aria-disabled", "true")
  fireEvent.click(screen.getByRole("menuitem", { name: "显示图表" }))
  expect(screen.queryByText("graph TD; A-->B")).not.toBeInTheDocument()
})

test("exports PNG from the preview and disables saving until it finishes", async () => {
  let finish!: (saved: boolean) => void
  vi.mocked(downloadChatFile).mockReturnValue(
    new Promise(resolve => {
      finish = resolve
    })
  )
  render(<MermaidDiagram source="graph TD; A-->B" />)
  await waitFor(() => expect(screen.getByRole("button", { name: "放大图表" })).toBeEnabled())
  fireEvent.click(screen.getByRole("button", { name: "放大图表" }))
  const dialog = await screen.findByRole("dialog")
  const download = within(dialog).getByRole("button", { name: "下载 PNG" })
  fireEvent.click(download)
  await waitFor(() => expect(downloadChatFile).toHaveBeenCalledWith("mermaid.png", "cG5n"))
  expect(download).toBeDisabled()
  await act(async () => finish(false))
  expect(download).toBeEnabled()
})

test("reports rasterization errors and permits retry", async () => {
  vi.mocked(diagramPng).mockRejectedValueOnce(new Error("PNG failed"))
  const error = vi.spyOn(toast, "error")
  render(<MermaidDiagram source="graph TD; A-->B" />)
  await waitFor(() => expect(screen.getByRole("button", { name: "放大图表" })).toBeEnabled())
  fireEvent.click(screen.getByRole("button", { name: "图表选项" }))
  fireEvent.click(await screen.findByRole("menuitem", { name: "下载 PNG" }))
  await waitFor(() => expect(error).toHaveBeenCalledWith("PNG failed"))
  fireEvent.click(screen.getByRole("button", { name: "图表选项" }))
  expect(await screen.findByRole("menuitem", { name: "下载 PNG" })).not.toHaveAttribute("aria-disabled", "true")
})

test("zooms inside the preview, preserves ordinary scrolling, and resets on reopening", async () => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1280)
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(640)
  render(<MermaidDiagram source="graph TD; A-->B" />)
  const expand = screen.getByRole("button", { name: "放大图表" })
  await waitFor(() => expect(expand).toBeEnabled())
  fireEvent.click(expand)
  const dialog = await screen.findByRole("dialog")
  const controls = within(dialog)
  const percent = controls.getByRole("button", { name: "恢复原始尺寸" })
  fireEvent.click(controls.getByRole("button", { name: "放大图片" }))
  expect(percent).toHaveTextContent("125%")
  expect(controls.getByRole("img")).toHaveStyle({ width: "800px", height: "400px" })
  const viewport = controls.getByRole("region", { name: "图表预览" })
  const scroll = new WheelEvent("wheel", { deltaX: 100, bubbles: true, cancelable: true })
  fireEvent(viewport, scroll)
  expect(scroll.defaultPrevented).toBe(false)
  expect(percent).toHaveTextContent("125%")
  const pinch = new WheelEvent("wheel", { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true })
  fireEvent(viewport, pinch)
  expect(pinch.defaultPrevented).toBe(true)
  await waitFor(() => expect(percent).toHaveTextContent("206%"))
  fireEvent.click(controls.getByRole("button", { name: "适应窗口" }))
  expect(percent).toHaveTextContent("200%")
  fireEvent.keyDown(viewport, { key: "0" })
  expect(percent).toHaveTextContent("100%")
  fireEvent.keyDown(viewport, { key: "+" })
  expect(percent).toHaveTextContent("125%")
  fireEvent.click(controls.getByRole("button", { name: "关闭预览" }))
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  fireEvent.click(expand)
  expect(await screen.findByRole("button", { name: "恢复原始尺寸" })).toHaveTextContent("100%")
})

test("accumulates wheel bursts and uses cumulative WebKit pinch scale without double zooming", async () => {
  render(<MermaidDiagram source="graph TD; A-->B" />)
  await waitFor(() => expect(screen.getByRole("button", { name: "放大图表" })).toBeEnabled())
  fireEvent.click(screen.getByRole("button", { name: "放大图表" }))
  const controls = within(await screen.findByRole("dialog"))
  const viewport = controls.getByRole("region", { name: "图表预览" })
  const percent = controls.getByRole("button", { name: "恢复原始尺寸" })
  act(() => {
    for (let i = 0; i < 10; i++) fireEvent.wheel(viewport, { deltaY: -10, ctrlKey: true })
  })
  await waitFor(() => expect(percent).toHaveTextContent("165%"))
  fireEvent.click(percent)
  const gesture = (type: string, scale: number) => {
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.assign(event, { scale, clientX: 100, clientY: 100 })
    fireEvent(viewport, event)
    expect(event.defaultPrevented).toBe(true)
  }
  gesture("gesturestart", 1)
  gesture("gesturechange", 1.2)
  await waitFor(() => expect(percent).toHaveTextContent("144%"))
  fireEvent.wheel(viewport, { deltaY: -100, ctrlKey: true })
  gesture("gesturechange", 1.5)
  gesture("gestureend", 1.5)
  await waitFor(() => expect(percent).toHaveTextContent("225%"))
  gesture("gesturestart", 1)
  gesture("gestureend", 1 / 1.5)
  await waitFor(() => expect(percent).toHaveTextContent("100%"))
  fireEvent.wheel(viewport, { deltaY: -100, ctrlKey: true })
  fireEvent.click(percent)
  await act(async () => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
  expect(percent).toHaveTextContent("100%")
})
