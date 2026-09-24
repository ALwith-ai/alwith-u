import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks"
import { createRef } from "react"
import { ChatSearch } from "../dialogs/chat-search"
import { threadRegistry } from "../lib/thread-registry"
import { applyUpdate, createSession } from "@alwith/api"
import { act, fireEvent, render, waitFor } from "@testing-library/react"
import { afterAll, expect, spyOn, test } from "bun:test"
import * as projectApps from "../open-in-editor"
import { must } from "@/lib/__tests__/must"
import * as opener from "@tauri-apps/plugin-opener"
import { client } from "@/lib/client"
import { initI18n } from "@/lib/i18n"
import { ChatActionsMenu } from "../chat-actions-menu"
import { installDom } from "../codex/__tests__/dom-environment"

installDom()
await initI18n("en")
const apps = spyOn(projectApps, "useProjectApps").mockImplementation(cwd => ({
  apps: [],
  active: undefined,
  openWith: () => {},
  refresh: () => {},
  openPreferred: () => opener.openPath(must(cwd, "project directory"))
}))
afterAll(() => apps.mockRestore())

test("draft menu hides session actions and opens the project directory itself", async () => {
  const open = spyOn(opener, "openPath").mockResolvedValue()
  try {
    const view = render(<ChatActionsMenu surface="floating" cwd="/tmp/project" onNewChat={() => {}} />)
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "More actions" }))
    })
    for (const name of ["Rename", "Find in chat", "Delete"]) {
      expect(view.queryByRole("menuitem", { name })).toBeNull()
    }
    await act(async () => {
      fireEvent.click(view.getByRole("menuitem", { name: "Open project folder" }))
    })
    expect(open).toHaveBeenCalledWith("/tmp/project")
  } finally {
    open.mockRestore()
  }
})

test("delete requires confirmation, keeps the dialog on failure and reports the explicit id only on success", async () => {
  const state = client.state
  client.store.setState({ connection: "ready" })
  const remove = spyOn(client, "delete").mockRejectedValueOnce(new Error("Cannot delete yet")).mockResolvedValue()
  const deleted: string[] = []
  try {
    const view = render(
      <ChatActionsMenu
        surface="floating"
        session={createSession("floating-id", "/tmp/project")}
        cwd="/tmp/project"
        onNewChat={() => {}}
        onDeleted={id => deleted.push(id)}
      />
    )
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "More actions" }))
    })
    await act(async () => {
      fireEvent.click(view.getByRole("menuitem", { name: "Delete" }))
    })
    expect(remove).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Delete", exact: true }))
    })
    expect(deleted).toEqual([])
    expect(view.getByRole("dialog")).toBeDefined()
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Delete", exact: true }))
    })
    await waitFor(() => expect(deleted).toEqual(["floating-id"]))
    expect(remove).toHaveBeenCalledWith("floating-id")
  } finally {
    remove.mockRestore()
    act(() => client.store.setState(state, true))
  }
})

test("menu search opens the current chat search and keeps focus in its input", async () => {
  mockWindows("chat")
  mockIPC(() => {}, { shouldMockEvents: true })
  const registry = threadRegistry.getState()
  threadRegistry.setState({ sessionId: null, turns: [] })
  const rootRef = createRef<HTMLDivElement>()
  const view = render(
    <div ref={rootRef}>
      <ChatActionsMenu
        surface="floating"
        session={applyUpdate(createSession("search-id", "/tmp/project"), {
          sessionUpdate: "user_message",
          messageId: "search-message",
          content: [{ type: "text", text: "Find me" }]
        })}
        cwd="/tmp/project"
        onNewChat={() => {}}
      />
      <ChatSearch rootRef={rootRef} sessionId="search-id" />
      <div data-chat-scroll />
    </div>
  )
  try {
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "More actions" }))
    })
    await act(async () => {
      fireEvent.click(view.getByRole("menuitem", { name: "Find in chat" }))
    })
    await waitFor(() => expect(document.activeElement).toBe(view.getByRole("textbox")))
    expect(view.queryByRole("menu")).toBeNull()
  } finally {
    view.unmount()
    await act(async () => {
      threadRegistry.setState(registry, true)
    })
    clearMocks()
  }
})

test("main draft menu keeps window transfer inside the menu and hides inapplicable actions", async () => {
  let transferred = 0
  const view = render(
    <ChatActionsMenu
      surface="main"
      cwd={null}
      onNewChat={() => {}}
      onOpenWindow={() => {
        transferred++
      }}
    />
  )
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "More actions" }))
  })
  expect(view.queryAllByRole("menuitem")).toHaveLength(1)
  expect(view.queryByRole("separator")).toBeNull()
  await act(async () => {
    fireEvent.click(view.getByRole("menuitem"))
  })
  expect(transferred).toBe(1)
})

test("floating draft without a project has no empty menu", () => {
  const view = render(<ChatActionsMenu surface="floating" cwd={null} onNewChat={() => {}} />)
  expect(view.queryByRole("button", { name: "More actions" })).toBeNull()
})
