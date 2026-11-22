import { groupSessions, isQuickChatDirectory, sessionGroup } from "@alwith/module-chat/client"
import { expect, test } from "vitest"

import { projectContext } from "@alwith/module-chat/testing"

test.each([
  ["/Users/mac", "chat"],
  ["/Users/macbookpro", "home"],
  ["C:/Users/Alice", "chat"],
  ["C:/Users/macbookpro", "home"]
])("registered default directories under %s do not capture unassigned quick-chat history", (home, root) => {
  const context = projectContext(home)
  const cwd = context.chatDirectory
  context.projects = [
    {
      id: "alwith-project",
      name: "ALwith",
      roots: [{ path: root === "home" ? home : cwd }],
      metadata: {},
      createdAt: 0,
      updatedAt: 0,
      recencyAt: null
    }
  ]
  const quickChat = { sessionId: "quick", cwd, projectId: null }
  const projectChat = { sessionId: "project", cwd, projectId: "alwith-project" }
  expect(groupSessions([quickChat, projectChat], context)).toEqual([
    ["quick-chats", [quickChat]],
    ["project:alwith-project", [projectChat]]
  ])
  expect(sessionGroup(context, quickChat).cwd).toBeNull()
  expect(isQuickChatDirectory(cwd, context)).toBe(true)
  expect(sessionGroup(context, { cwd: `${home}/work/app`, projectId: null }).id).toBe(`${home}/work/app`)
  expect(sessionGroup(context, { cwd: `${home}/Documents/Codex/day/chat`, projectId: null }).id).toBe("quick-chats")
})
