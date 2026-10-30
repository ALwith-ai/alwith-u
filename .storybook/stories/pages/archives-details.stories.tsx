import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, spyOn, waitFor, within } from "storybook/test"

import type { ThreadSummary } from "../../../src/agent/client"
import { SidebarInset } from "../../../src/components/ui/sidebar"
import { LeadingNavigation } from "../../../src/features/layout/components/leading-navigation"
import { MainSidebarLayout } from "../../../src/features/layout/components/main-sidebar-layout"
import { ArchivedChatsPage } from "../../../src/features/threads/archived-chats-page"
import { client } from "../../../src/lib/client"

const chats: ThreadSummary[] = [
  {
    sessionId: "quick",
    cwd: "/Users/demo/Documents/Codex",
    title: "整理本周的工作安排",
    updatedAt: "2026-10-19T08:30:00Z",
    archived: true
  },
  {
    sessionId: "project",
    cwd: "/Projects/alwith-u",
    title: "检查导航与归档页面的交互",
    updatedAt: "2026-10-18T03:15:00Z",
    archived: true
  },
  {
    sessionId: "second",
    cwd: "/Projects/alwith-u",
    title: "梳理项目文件和开发文档",
    updatedAt: "2026-10-17T09:00:00Z",
    archived: true
  }
]

const meta = {
  id: "页面-聊天归档-布局细节",
  title: "页面/负一屏/归档/布局细节",
  component: ArchivedChatsPage,
  globals: { locale: "zh-CN" },
  beforeEach: () => {
    const previous = client.state
    client.store.setState({ connection: "ready", archivedThreads: [], archivedLoaded: false, archivedCursor: null })
    const list = spyOn(client, "listThreads").mockImplementation(() => {
      return Promise.try(() => {
        client.store.setState({ archivedThreads: chats, archivedLoaded: true, archivedCursor: null })
      })
    })
    const restore = spyOn(client, "unarchive").mockImplementation((id) => {
      return Promise.try(() => {
        client.store.setState((state) => ({
          archivedThreads: state.archivedThreads.filter((thread) => thread.sessionId !== id)
        }))
      })
    })
    const remove = spyOn(client, "delete").mockImplementation((id) => {
      return Promise.try(() => {
        client.store.setState((state) => ({
          archivedThreads: state.archivedThreads.filter((thread) => thread.sessionId !== id)
        }))
      })
    })
    return () => {
      list.mockRestore()
      restore.mockRestore()
      remove.mockRestore()
      client.store.setState(previous, true)
    }
  },
  render: () => (
    <div className="h-[640px] bg-sidebar">
      <MainSidebarLayout
        initialPinned={false}
        screen="leading"
        sidebar={<div className="p-8">Chats</div>}
        main={null}
        leading={
          <>
            <LeadingNavigation
              activePage="archives"
              onOpenVibemon={() => {}}
              onOpenPlugins={() => {}}
              onOpenExtensions={() => {}}
              onOpenArchives={() => {}}
            />
            <SidebarInset className="main-chat-surface flex min-h-0 flex-col">
              <ArchivedChatsPage />
            </SidebarInset>
          </>
        }
      />
    </div>
  )
} satisfies Meta<typeof ArchivedChatsPage>
export default meta
type Story = StoryObj<typeof meta>

export const ArchiveList: Story = {
  name: "归档列表",
  play: async ({ canvas, canvasElement, userEvent }) => {
    await waitFor(() => expect(canvas.getByRole("button", { name: "全部删除" })).toBeEnabled())
    await userEvent.type(canvas.getByRole("textbox", { name: "搜索已归档的聊天" }), "导航")
    await expect(canvas.queryByText("整理本周的工作安排")).not.toBeInTheDocument()
    await userEvent.click(canvas.getByRole("button", { name: "全部删除" }))
    const dialog = within(canvasElement.ownerDocument.body).getByRole("dialog")
    await expect(dialog).toHaveTextContent("3")
    await userEvent.click(within(dialog).getByRole("button", { name: "取消" }))
    await userEvent.clear(canvas.getByRole("textbox", { name: "搜索已归档的聊天" }))
    const sample = chats[0]
    if (!sample) throw new Error("Missing archive fixture")
    const contentBefore = canvas.getAllByRole("article")[0]?.getBoundingClientRect()
    if (!contentBefore) throw new Error("Missing archive row")
    client.store.setState({
      archivedThreads: Array.from({ length: 40 }, (_, index) => ({ ...sample, sessionId: `scroll-${index}` }))
    })
    await waitFor(() => expect(canvas.getAllByRole("article")).toHaveLength(40))
    const row = canvas.getAllByRole("article")[0]
    const list = row?.closest<HTMLElement>('[data-slot="scroll-area-viewport"]')
    if (!list) throw new Error("Missing archive list")
    const heading = canvas.getByRole("heading", { level: 1 })
    const search = canvas.getByRole("textbox", { name: "搜索已归档的聊天" })
    const headingTop = heading.getBoundingClientRect().top
    const searchTop = search.getBoundingClientRect().top
    void expect(row?.getBoundingClientRect().width).toBeCloseTo(contentBefore.width, 1)
    void expect(row?.getBoundingClientRect().right).toBeCloseTo(contentBefore.right, 1)
    void expect(row?.parentElement?.getBoundingClientRect().right).toBeCloseTo(
      canvas.getByRole("button", { name: "全部删除" }).getBoundingClientRect().right,
      1
    )
    await waitFor(() => expect(list.parentElement?.querySelector('[data-slot="scroll-area-scrollbar"]')).not.toBeNull())
    const scrollbar = list.parentElement?.querySelector('[data-slot="scroll-area-scrollbar"]')
    if (!scrollbar || !row?.parentElement) throw new Error("Missing archive scrollbar")
    void expect(
      scrollbar.getBoundingClientRect().left - row.parentElement.getBoundingClientRect().right
    ).toBeGreaterThanOrEqual(8)
    void expect(list.scrollHeight).toBeGreaterThan(list.clientHeight)
    list.scrollTop = 300
    await waitFor(() => expect(list.scrollTop).toBeGreaterThan(0))
    void expect(heading.getBoundingClientRect().top).toBe(headingTop)
    void expect(search.getBoundingClientRect().top).toBe(searchTop)
    client.store.setState({ archivedThreads: chats })
  }
}
