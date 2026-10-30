import { ScrollArea } from "@base-ui/react/scroll-area"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { expect, waitFor } from "storybook/test"

import { Pane } from "../../../src/components/alwith-ui/pane"
import { Button } from "../../../src/components/ui/button"

function ScrollAreaExample({ navigation = false }: { navigation?: boolean }) {
  const [overflow, setOverflow] = useState(true)
  return (
    <div className="flex flex-col gap-4">
      <Button onClick={() => setOverflow((value) => !value)}>Toggle overflow</Button>
      <div className="flex h-60 w-72 bg-sidebar text-sidebar-foreground" data-scroll-panel>
        <Pane
          viewportClassName={navigation ? "ps-2 pe-0.5" : undefined}
          viewportProps={{ "aria-label": "Scrollable items" }}
        >
          <ScrollArea.Content>
            {Array.from({ length: overflow ? 40 : 2 }, (_, index) => (
              <button
                key={index}
                type="button"
                className={`flex h-8 w-full items-center gap-2 ${navigation ? "ps-1 pe-1.5" : ""}`}
              >
                <span className="min-w-0 flex-1 truncate text-start">A long conversation title {index + 1}</span>
                <span className="shrink-0" data-scroll-tail>
                  {index + 1}
                </span>
              </button>
            ))}
          </ScrollArea.Content>
        </Pane>
      </div>
    </div>
  )
}

const meta = {
  id: "页面-通用细节-滚动区域",
  globals: { locale: "en" },
  title: "页面/其他/通用细节/滚动区域",
  component: ScrollAreaExample,
  play: async ({ canvasElement, canvas, userEvent }) => {
    const root = canvasElement.querySelector<HTMLElement>('[data-slot="scroll-area"]')!
    const viewport = canvasElement.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')!
    const tail = canvasElement.querySelector<HTMLElement>("[data-scroll-tail]")!
    await waitFor(async () => {
      const track = canvasElement.querySelector<HTMLElement>('[data-slot="scroll-area-scrollbar"]')!
      const thumb = canvasElement.querySelector<HTMLElement>('[data-slot="scroll-area-thumb"]')!
      await expect(track.getBoundingClientRect().width).toBe(10)
      await expect(thumb.getBoundingClientRect().width).toBe(6)
      const rtl = getComputedStyle(root).direction === "rtl"
      const edge = rtl ? "left" : "right"
      await expect(track.getBoundingClientRect()[edge]).toBe(root.getBoundingClientRect()[edge])
      await expect(Math.abs(thumb.getBoundingClientRect()[edge] - root.getBoundingClientRect()[edge])).toBe(2)
      const clearance = rtl
        ? tail.getBoundingClientRect().left - thumb.getBoundingClientRect().right
        : thumb.getBoundingClientRect().left - tail.getBoundingClientRect().right
      await expect(clearance).toBeGreaterThanOrEqual(8)
    })
    viewport.focus()
    await waitFor(async () => {
      const track = canvasElement.querySelector<HTMLElement>('[data-slot="scroll-area-scrollbar"]')!
      await expect(getComputedStyle(track).opacity).toBe("1")
    })
    const width = viewport.getBoundingClientRect().width
    const tailPosition = tail.getBoundingClientRect().x
    await userEvent.click(canvas.getByRole("button", { name: "Toggle overflow" }))
    await waitFor(async () => expect(canvasElement.querySelector('[data-slot="scroll-area-scrollbar"]')).toBeNull())
    await expect(viewport.getBoundingClientRect().width).toBe(width)
    await expect(tail.getBoundingClientRect().x).toBe(tailPosition)
  }
} satisfies Meta<typeof ScrollAreaExample>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { name: "默认状态" }
export const Navigation: Story = { name: "导航滚动", args: { navigation: true } }
export const RightToLeft: Story = { name: "从右向左布局", args: { navigation: true }, globals: { locale: "ar" } }
