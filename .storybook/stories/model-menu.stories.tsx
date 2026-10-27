import { type ChatModelOption, ModelSelect } from "@alwith/module-chat/model-select"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { mockIPC } from "@tauri-apps/api/mocks"
import { ExternalLink } from "lucide-react"
import { type ReactElement, useState } from "react"
import { expect, fn, waitFor, within } from "storybook/test"

import { DropdownMenuItem } from "../../src/components/ui/dropdown-menu"
import { modelTriggerLabel, presentModelCatalog } from "../../src/features/chat/composer/model-catalog"
import type { SettingsRequest } from "../../src/lib/settings-store"

const catalog = [
  {
    id: "chatgpt",
    name: "ChatGPT",
    models: ["GPT-6.1-Sol", "GPT-6-Astra", "GPT-6-Luna", "GPT-5.6-Terra", "GPT-6-Sol"].map((label) => ({
      api_id: label,
      label
    }))
  },
  { id: "deepseek", name: "DeepSeek", models: [{ api_id: "deepseek", label: "DeepSeek-Flash" }] },
  {
    id: "qwen",
    name: "Qwen",
    models: ["3.8 Max", "3.8 Flash", "3.7 Max", "3.7 Plus", "3.6 Flash"].map((label) => ({ api_id: label, label }))
  }
]

const configureModels = fn()

function ModelMenuPreview({ delay = 0 }: { delay?: number }): ReactElement {
  const [selected, setSelected] = useState("GPT-6.1-Sol")
  const [effort, setEffort] = useState("medium")
  const [fast, setFast] = useState(false)
  const groups = presentModelCatalog(catalog)
  const models = groups.flatMap((group) => group.models)
  const selectedModel = models.find((model) => model.api_id === selected)!
  const supportsFast = selected.startsWith("GPT")
  return (
    <div className="flex h-[540px] items-end justify-center">
      <ModelSelect<ChatModelOption>
        value={{ ...selectedModel, label: modelTriggerLabel(selectedModel) }}
        models={models}
        modelGroups={groups}
        compactCatalog
        header={{
          name: "模型",
          action: (
            <DropdownMenuItem onClick={configureModels} className="h-9 gap-2 rounded-md px-2 text-sm font-normal">
              更多模型
              <ExternalLink className="ml-auto size-4" aria-hidden="true" />
            </DropdownMenuItem>
          )
        }}
        onChange={(model) => {
          setSelected(model.api_id)
          setFast(false)
        }}
        effortConfig={{
          name: "Effort",
          value: effort,
          levels: [
            { value: "low", name: "Low" },
            { value: "medium", name: "Medium" },
            { value: "high", name: "Extra High" }
          ],
          onChange: async (value) => {
            if (delay) await new Promise<void>((resolve) => setTimeout(resolve, delay))
            setEffort(value)
          }
        }}
        booleanOptions={[
          {
            id: "fast_mode",
            name: "快速",
            currentValue: fast,
            disabled: !supportsFast,
            title: !supportsFast ? "当前模型不支持快速模式" : undefined
          }
        ]}
        onBooleanChange={(_id, value) => setFast(value)}
        t={(key) => (key === "model.moreModels" ? "更多模型" : "切换模型")}
      />
    </div>
  )
}

const meta = {
  title: "Chat/Model menu",
  component: ModelMenuPreview,
  globals: { locale: "zh-CN" },
  beforeEach: () => {
    configureModels.mockClear()
    let revision = Date.now()
    let values: Record<string, unknown> = {}
    mockIPC((command, payload) => {
      if (command === "plugin:log|log") return
      if (command === "settings_request") {
        if (!payload || !("input" in payload)) throw new Error("Missing settings request")
        const input = payload.input as SettingsRequest
        values = { ...values, ...input.changes }
        return { revision: ++revision, values, browserMigrated: true }
      }
      throw new Error(`Unexpected model preview IPC command: ${command}`)
    })
    return () => {
      mockIPC((command) => {
        if (command === "plugin:log|log") return
        throw new Error(`Unexpected Storybook IPC command: ${command}`)
      })
    }
  }
} satisfies Meta<typeof ModelMenuPreview>
export default meta
type Story = StoryObj<typeof meta>

export const Overview: Story = {}

export const DelayedEffort: Story = {
  args: { delay: 500 },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByTestId("model-trigger"))
    const slider = within(document.body).getByRole("slider", { name: "Effort" })
    slider.focus()
    await userEvent.keyboard("{ArrowRight}")
    for (let frame = 0; frame < 12; frame++) {
      await expect(slider).toHaveAttribute("aria-valuetext", "Extra High")
      await new Promise<void>((resolve) => setTimeout(resolve, 60))
    }
    await userEvent.keyboard("{Escape}")
    await userEvent.unhover(canvas.getByTestId("model-trigger"))
    await waitFor(async () => expect(document.querySelector("[data-base-ui-focus-guard]")).toBeNull())
  }
}

export const Providers: Story = {
  play: async ({ canvas, userEvent }) => {
    const body = within(document.body)
    await userEvent.click(canvas.getByTestId("model-trigger"))
    await expect(body.getAllByRole("menuitemradio")).toHaveLength(11)
    const qwen = body.getByRole("menuitemradio", { name: "3.8 Flash" })
    qwen.focus()
    await userEvent.keyboard("{Enter}")
    await expect(canvas.getByTestId("model-trigger")).toHaveTextContent("3.8 Flash")
    canvas.getByTestId("model-trigger").focus()
    await userEvent.keyboard("{Enter}")
    await expect(body.getByRole("menuitemcheckbox", { name: "快速" })).toHaveAttribute("aria-disabled", "true")
    const slider = body.getByRole("slider", { name: "Effort" })
    await waitFor(async () =>
      expect(
        slider
          .closest('[data-slot="dropdown-menu-content"]')!
          .getAnimations()
          .some((animation) => animation.playState === "running")
      ).toBe(false)
    )
    const labelWidth = slider.previousElementSibling!.getBoundingClientRect().width
    slider.focus()
    await userEvent.keyboard("{ArrowRight}")
    await expect(slider.previousElementSibling!.getBoundingClientRect().width).toBe(labelWidth)
    await expect(slider).toHaveAttribute("aria-valuetext", "Extra High")
    await userEvent.keyboard("{Escape}")
    await expect(canvas.getByTestId("model-trigger")).toHaveTextContent("Extra High")
    await waitFor(async () => expect(document.querySelector("[data-base-ui-focus-guard]")).toBeNull())
  }
}

export const ScrollableCatalog: Story = {
  play: async ({ canvas, userEvent }) => {
    const body = within(document.body)
    await userEvent.click(canvas.getByTestId("model-trigger"))
    await waitFor(async () => expect(document.querySelector("[data-model-menu-list]")).not.toBeNull())
    const list = document.querySelector<HTMLElement>("[data-model-menu-list]")!
    await waitFor(
      async () =>
        await expect(list.parentElement!.getAnimations().some((animation) => animation.playState === "running")).toBe(
          false
        )
    )
    const header = document.querySelector<HTMLElement>("[data-model-menu-header]")!
    const footer = document.querySelector<HTMLElement>("[data-model-menu-footer]")!
    await waitFor(async () => expect(list.scrollHeight).toBeGreaterThan(list.clientHeight))
    const headerTop = header.getBoundingClientRect().top
    const footerTop = footer.getBoundingClientRect().top
    list.scrollTop = list.scrollHeight
    await expect(list.scrollTop).toBeGreaterThan(0)
    await expect(header.getBoundingClientRect().top).toBe(headerTop)
    await expect(footer.getBoundingClientRect().top).toBe(footerTop)
    await expect(getComputedStyle(list).scrollbarWidth).not.toBe("none")
    body.getByRole("menuitem", { name: "更多模型" }).focus()
    await userEvent.keyboard("{Enter}")
    await expect(configureModels).toHaveBeenCalled()
    await waitFor(async () => expect(body.queryByRole("menu")).toBeNull())
  }
}

export const Dark: Story = {
  globals: { theme: "dark" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByTestId("model-trigger"))
    await waitFor(async () => expect(document.querySelector("[data-model-menu-list]")).not.toBeNull())
  }
}
