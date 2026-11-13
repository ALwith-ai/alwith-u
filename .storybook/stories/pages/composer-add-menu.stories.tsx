import { CodexClient, createSession } from "@alwith/module-chat/client"
import { Composer, type ConversationHost, ConversationProvider, drafts } from "@alwith/module-chat/conversation"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { expect, within } from "storybook/test"

import { useTheme } from "@/components/theme-provider"
import { skillIconSrc } from "@/features/plugins/skill-icon"

import { configOptions } from "../../fixtures/catalog"

function ComposerPreview({ appState = "ready" }: { appState?: "ready" | "empty" | "error" }) {
  const { t, i18n } = useTranslation("alwithChat")
  const { resolvedTheme } = useTheme()
  const host: ConversationHost = {
    t: (key, values) => t(key, values ?? {}),
    i18n,
    theme: resolvedTheme,
    skillIcon: skillIconSrc,
    openLink: () => {},
    Markdown: ({ text }) => <p>{text}</p>,
    reportError: () => {}
  }
  const { client, session } = useMemo(() => {
    const client = new CodexClient(
      () => {
        throw new Error("Native Runtime is disabled in this preview")
      },
      { agentId: "preview", launch: { engine: "preview" } }
    )
    client.installedApps = async () => {
      if (appState === "error") throw new Error("App catalog unavailable")
      return {
        apps:
          appState === "empty"
            ? []
            : ["Figma", "飞书", "公司知识库", "Sites"].map((name) => ({
                id: name,
                runtimeName: name,
                enabled: true,
                callable: true
              }))
      }
    }
    const session = {
      ...createSession("add-menu-preview", "/Users/demo/alwith-u"),
      attached: true,
      configOptions,
      commands: [
        { type: "command" as const, name: "plan", description: "先讨论方案，再开始实施" },
        { type: "command" as const, name: "review", description: "审查当前代码改动" },
        { type: "command" as const, name: "status", description: "查看当前会话状态" },
        ...["文档分析", "imagegen", "openai-docs", "界面设计", "数据分析", "代码审查", "会议纪要"].map((name) => ({
          type: "command" as const,
          name: `$${name}`,
          description: `使用${name}技能处理当前任务`
        }))
      ]
    }
    return { client, session }
  }, [appState])
  return (
    <div className="flex min-h-[640px] items-end pb-8">
      <ConversationProvider client={client} host={host}>
        <Composer
          session={session}
          inputHeader={<span className="px-2 py-1 text-sm">alwith-u</span>}
          predictions={false}
          onSubmit={async () => {}}
        />
      </ConversationProvider>
    </div>
  )
}

const meta = {
  id: "composer-add-menu-source",
  title: "页面/主窗聊天/输入框/02 输入框功能/00 添加菜单",
  component: ComposerPreview,
  parameters: { layout: "fullscreen" },
  // The draft outlives the composer; each story starts from an empty one.
  beforeEach: () => {
    drafts.delete("add-menu-preview")
    return () => {
      drafts.delete("add-menu-preview")
    }
  }
} satisfies Meta<typeof ComposerPreview>
export default meta
type Story = StoryObj<typeof meta>

export const Grouped: Story = {
  name: "附件与命令、技能、应用",
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "添加附件、命令或应用" }))
  }
}
export const SlashShortcut: Story = {
  name: "快捷入口 · 命令、技能、应用",
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(await canvas.findByRole("textbox", { name: "发送消息" }), "/")
  }
}
export const SlashParity: Story = {
  name: "同一菜单 · 快捷入口无附件",
  tags: ["layout"],
  play: async (context) => {
    const body = within(context.canvasElement.ownerDocument.body)
    const view = context.canvasElement.ownerDocument.defaultView!
    const appearance = (row: HTMLElement) => {
      const label = view.getComputedStyle(row.querySelector("span")!)
      return {
        height: row.getBoundingClientRect().height,
        fontSize: label.fontSize,
        fontWeight: label.fontWeight,
        iconWidth: row.querySelector("svg")!.getBoundingClientRect().width,
        background: view.getComputedStyle(row).backgroundColor
      }
    }
    await SlashShortcut.play!(context)
    const slashMenu = (await body.findByRole("listbox")).getBoundingClientRect()
    const slashRow = await body.findByRole("option", { name: /review/ })
    await context.userEvent.hover(slashRow)
    const slashAppearance = appearance(slashRow)
    await context.userEvent.keyboard("{Escape}")
    await Grouped.play!(context)
    const addMenu = (await body.findByRole("listbox", { name: "添加附件、命令或应用" })).getBoundingClientRect()
    const addRow = await body.findByRole("option", { name: /review/ })
    await context.userEvent.hover(addRow)
    await expect(Math.abs(slashMenu.width - addMenu.width)).toBeLessThan(1)
    await expect(Math.abs(slashMenu.left - addMenu.left)).toBeLessThan(1)
    await expect(Math.abs(slashMenu.bottom - addMenu.bottom)).toBeLessThan(1)
    await expect(appearance(addRow)).toEqual(slashAppearance)
  }
}
export const SkillSelected: Story = {
  name: "技能插入草稿",
  play: async (context) => {
    await Grouped.play!(context)
    await context.userEvent.click(
      await within(context.canvasElement.ownerDocument.body).findByRole("option", { name: /文档分析/ })
    )
  }
}
export const AppsEmpty: Story = { ...Grouped, name: "没有可调用的应用", args: { appState: "empty" } }
export const AppsError: Story = { ...Grouped, name: "应用读取失败", args: { appState: "error" } }

export const Placement: Story = {
  name: "与输入框等宽并覆盖项目条",
  tags: ["layout"],
  play: async (context) => {
    const input = await context.canvas.findByRole("textbox", { name: "发送消息" })
    const surface = input.closest("form")!.getBoundingClientRect()
    const project = context.canvasElement.querySelector("[data-chat-input-header]")!.getBoundingClientRect()
    await Grouped.play!(context)
    const menu = (
      await within(context.canvasElement.ownerDocument.body).findByRole("listbox", { name: "添加附件、命令或应用" })
    ).getBoundingClientRect()
    await expect(Math.abs(menu.width - surface.width)).toBeLessThan(1)
    await expect(Math.abs(menu.left - surface.left)).toBeLessThan(1)
    await expect(Math.abs(menu.bottom - (surface.top - 8))).toBeLessThan(1)
    await expect(menu.bottom).toBeGreaterThan(project.top)
    await expect(menu.top).toBeLessThan(project.bottom)
  }
}

export const SlashAppSelected: Story = {
  name: "快捷入口 · 选择应用",
  play: async (context) => {
    await SlashShortcut.play!(context)
    await context.userEvent.click(
      await within(context.canvasElement.ownerDocument.body).findByRole("option", { name: "Figma" })
    )
  }
}
export const SlashAppsError: Story = { ...SlashShortcut, name: "快捷入口 · 应用读取失败", args: { appState: "error" } }
