import { expect, test } from "vitest"

import { projectContext } from "@/agent/__tests__/project-context"

import { newChatDirectory } from "../new-chat-directory"

test.each([null, "/Users/mac/Documents/Codex/project", "/Users/mac/Documents/ALwith", "/Users/mac"])(
  "new chat from %s requests the host's default workspace",
  (cwd) => {
    const context = projectContext(cwd?.startsWith("C:") ? "C:/Users/Alice" : "/Users/mac")
    expect(newChatDirectory(cwd, context)).toBeNull()
  }
)

test.each([
  "/project",
  "/Users/mac/Documents/ALwith U",
  String.raw`C:\Users\Alice\Documents\ALwith U`,
  "/Users/mac/Documents/ALwith/project",
  "/var/folders-other/project",
  "/private/var/folders/example/T/project",
  "/var/folders/example/T/project",
  "/tmp/project",
  String.raw`C:\Users\Alice\AppData\Local\Temp\project`,
  String.raw`C:\Windows\Temp\project`,
  String.raw`D:\Scratch\project`
])("new chat retains the project directory %s, including temporary workspaces", (cwd) => {
  const context = projectContext(cwd?.startsWith("C:") ? "C:/Users/Alice" : "/Users/mac")
  expect(newChatDirectory(cwd, context)).toBe(cwd)
})

test("preserves directory intent before project context arrives", () => {
  expect(newChatDirectory("/Users/mac/Documents/ALwith", null)).toBe("/Users/mac/Documents/ALwith")
})
