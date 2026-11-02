import type { Session } from "@alwith/module-chat/client"
import { drafts } from "@alwith/module-chat/conversation"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { useEffect, useRef, useState } from "react"

import base from "./composer-details.stories"

const session = base.args.session
const Composer = base.component

function PressureComposer() {
  const [current, setCurrent] = useState<Session>(() => ({
    ...session,
    id: "composer-pressure",
    state: "running",
    configOptions: [
      {
        type: "select",
        configId: "model",
        category: "model",
        name: "Model",
        currentValue: "model-0",
        options: Array.from({ length: 3000 }, (_, index) => ({ value: `model-${index}`, name: `Model ${index}` }))
      }
    ],
    items: Array.from({ length: 10000 }, (_, index) => ({
      kind: "user",
      id: `pressure-${index}`,
      at: index,
      replayed: true,
      echo: null,
      _meta: null,
      content: [{ type: "text", text: `Earlier prompt ${index}` }]
    }))
  }))
  const surface = useRef<HTMLDivElement>(null)
  const [result, setResult] = useState("Ready")
  useEffect(() => {
    // Simulate incoming stream updates without starting an agent or using a Codex home.
    const timer = setInterval(() => setCurrent((previous) => ({ ...previous })), 25)
    return () => {
      clearInterval(timer)
      drafts.delete("composer-pressure")
    }
  }, [])
  const measure = async () => {
    const input = surface.current?.querySelector<HTMLTextAreaElement>("textarea")
    if (!input) throw new Error("Composer textarea is missing")
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!
    const dispatch = (value: string) => {
      descriptor.set!.call(input, value)
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "字" }))
    }
    dispatch("中文 abc ".repeat(3000))
    const samples: number[] = []
    for (let index = 0; index < 120; index++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      const start = performance.now()
      dispatch(`${input.value}字`)
      samples.push(performance.now() - start)
    }
    const ordered = samples.toSorted((a, b) => a - b)
    setResult(
      JSON.stringify({
        keys: 120,
        models: 3000,
        messages: 10000,
        streamUpdatesPerSecond: 40,
        characters: input.value.length,
        inputP95Ms: Number(ordered[114].toFixed(2)),
        maxMs: Number(ordered.at(-1)!.toFixed(2)),
        height: input.getBoundingClientRect().height
      })
    )
  }
  return (
    <div ref={surface}>
      <button
        type="button"
        onClick={() => {
          void measure()
        }}
      >
        Measure typing under stream load
      </button>
      <output aria-label="Typing pressure result" className="block text-sm break-all">
        {result}
      </output>
      <Composer session={current} onSubmit={async () => {}} />
    </div>
  )
}

const meta = {
  ...base,
  id: "页面-聊天-输入压力",
  tags: [],
  title: "页面/主窗聊天/输入压力",
  component: PressureComposer,
  args: {}
} satisfies Meta<typeof PressureComposer>
export default meta
type Story = StoryObj<typeof meta>

export const TypingPressure: Story = {
  name: "输入压力：长会话与持续更新"
}
