import { groupSessions, isQuickChatDirectory, sessionGroup } from "@alwith/module-chat/client"
import { expect, test } from "vitest"

import { projectContext } from "./project-context"

test("the installed shared projection groups default chats under their registered project", () => {
  const context = projectContext()
  context.projects.push({
    id: "default",
    name: "ALwith",
    roots: [{ path: context.chatDirectory }],
    metadata: {},
    position: 0,
    createdAt: 0,
    updatedAt: 0,
    recencyAt: null
  })
  const chat = { cwd: context.chatDirectory, projectId: "default" }
  const project = { cwd: `${context.chatDirectory  }/workspace` }
  expect(sessionGroup(context, chat).id).toBe("project:default")
  expect(isQuickChatDirectory(context.chatDirectory, context)).toBe(false)
  expect(groupSessions([chat, project], context).map(([id, rows]) => [id, rows])).toEqual([
    ["quick-chats", []],
    ["project:default", [chat, project]]
  ])
})
