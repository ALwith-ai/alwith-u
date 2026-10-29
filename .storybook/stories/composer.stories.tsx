import { createSession, type Session } from "@nyssance/codex-acp-v2/client";
import { drafts } from "@alwith/module-chat/conversation"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { mockIPC } from "@tauri-apps/api/mocks"
import { type ComponentProps, type ReactNode, useState } from "react"
import { expect, fn, waitFor } from "storybook/test"

import { ChatHostProvider } from "../../src/features/chat/chat-host"
import { ChatComposer } from "../../src/features/chat/composer"
import { DraftProjectPicker } from "../../src/features/chat/draft-project-picker"
import type { SettingsRequest } from "../../src/lib/settings-store"

const session: Session = {
  ...createSession("composer-preview", "/Projects/alwith"),
  attached: true,
  commands: [{ name: "plan", description: "Plan a task" }],
  configOptions: [
    {
      configId: "model",
      category: "model",
      name: "Model",
      type: "select",
      currentValue: "gpt-6.1-sol",
      options: [{ value: "gpt-6.1-sol", name: "GPT-6.1 Sol" }]
    },
    {
      configId: "effort",
      category: "thought_level",
      name: "Effort",
      type: "select",
      currentValue: "medium",
      options: [{ value: "medium", name: "中" }]
    },
    {
      configId: "mode",
      category: "mode",
      name: "Permissions",
      type: "select",
      currentValue: "read-only",
      options: [{ value: "read-only", name: "Read only" }]
    }
  ]
}

/** U's composer with U's host, as the conversation view mounts it. */
function Composer(props: ComponentProps<typeof ChatComposer>) {
  return (
    <ChatHostProvider>
      <ChatComposer {...props} />
    </ChatHostProvider>
  )
}

const meta = {
  title: "Chat/Composer",
  component: Composer,
  globals: { locale: "zh-CN" },
  args: {
    session,
    onSubmit: fn(async () => {}),
    inputHeader: <ProjectPickerPreview />
  },
  beforeEach: () => {
    drafts.delete(session.id)
    let revision = Date.now()
    let values: Record<string, unknown> = { "voice.enabled": true }
    mockIPC((command, payload) => {
      if (command === "plugin:log|log") return
      if (command === "draft_directory") return "/Users/demo/Documents/Codex"
      if (command === "settings_request") {
        if (!payload || !("input" in payload)) throw new Error("Missing settings request")
        const input = payload.input as SettingsRequest
        values = { ...values, ...input.changes }
        return { revision: ++revision, values, browserMigrated: true }
      }
      throw new Error(`Unexpected composer preview IPC command: ${command}`)
    })
    return () => {
      drafts.delete(session.id)
      mockIPC((command) => {
        if (command === "plugin:log|log") return
        throw new Error(`Unexpected Storybook IPC command: ${command}`)
      })
    }
  }
} satisfies Meta<typeof Composer>
export default meta
type Story = StoryObj<typeof meta>

export const Project: Story = {
  play: async ({ canvasElement, canvas, userEvent, args }) => {
    const surface = canvasElement.querySelector<HTMLElement>(".codex-composer-surface")!
    const textarea = canvas.getByRole("textbox")
    const project = canvasElement.querySelector<HTMLElement>(".chat-project-picker")!
    await expect(getComputedStyle(project).backgroundColor).toBe("rgba(0, 0, 0, 0)")
    await waitFor(async () => expect(surface.getBoundingClientRect().height).toBe(100))
    const toolbar = canvasElement.querySelector<HTMLElement>(".chat-composer-toolbar")!
    await expect(toolbar.getBoundingClientRect().bottom).toBeLessThan(surface.getBoundingClientRect().bottom)
    await userEvent.type(textarea, "/")
    const list = await canvas.findByRole("listbox")
    await expect(list.getBoundingClientRect().left).toBe(surface.getBoundingClientRect().left)
    await expect(list.getBoundingClientRect().width).toBe(surface.getBoundingClientRect().width)
    await userEvent.click(canvas.getByRole("option"))
    await expect(textarea).toHaveValue("/plan ")
    await userEvent.click(canvas.getByRole("button", { name: "发送" }))
    await waitFor(async () => expect(args.onSubmit).toHaveBeenCalled())
    await waitFor(async () => expect(textarea).toHaveValue(""))
  }
}

export const NoProject: Story = {
  args: { inputHeader: <DraftProjectPicker cwd={null} recentProjects={[]} onChange={fn()} /> }
}

export const Narrow: Story = {
  decorators: [
    (Story) => (
      <div className="w-[360px] max-w-full">
        <Story />
      </div>
    )
  ],
  play: async ({ canvasElement, canvas }) => {
    const surface = canvasElement.querySelector<HTMLElement>(".codex-composer-surface")!
    for (const button of canvas.getAllByRole("button")) {
      await expect(button.getBoundingClientRect().left).toBeGreaterThanOrEqual(surface.getBoundingClientRect().left)
      await expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(surface.getBoundingClientRect().right)
    }
  }
}

export const Dark: Story = {
  globals: { theme: "dark" }
}

export const LongDraft: Story = {
  play: async ({ canvasElement, canvas, userEvent }) => {
    const surface = canvasElement.querySelector<HTMLElement>(".codex-composer-surface")!
    const textarea = canvas.getByRole<HTMLTextAreaElement>("textbox")
    await userEvent.click(textarea)
    await userEvent.paste(Array.from({ length: 40 }, (_, index) => `Line ${index + 1}`).join("\n"))
    await waitFor(async () => expect(textarea.scrollHeight).toBeGreaterThan(textarea.clientHeight))
    await expect(getComputedStyle(surface).overflowY).toBe("clip")
    await expect(getComputedStyle(textarea).scrollbarWidth).toBe("none")
    textarea.scrollTop = textarea.scrollHeight
    await expect(textarea.scrollTop).toBeGreaterThan(0)
    await expect(canvas.getByRole("button", { name: "发送" })).toBeVisible()
  }
}

function ProjectPickerPreview(): ReactNode {
  const [cwd, setCwd] = useState<string | null>("/Projects/alwith")
  return <DraftProjectPicker cwd={cwd} recentProjects={[]} onChange={setCwd} />
}

export const ExitProject: Story = {
  play: async ({ canvas, userEvent }) => {
    const clear = canvas.getByRole("button", { name: "不在项目中工作" })
    await waitFor(async () => expect(clear).toBeEnabled())
    await userEvent.click(clear)
    await expect(canvas.queryByRole("button", { name: "不在项目中工作" })).toBeNull()
    await expect(canvas.getByRole("button", { name: "选择项目" })).toBeVisible()
    await expect(canvas.queryByRole("menu")).toBeNull()
  }
}
