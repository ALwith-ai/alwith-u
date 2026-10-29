import { afterEach, expect, test } from "vitest"

import { projectContext } from "@/agent/__tests__/project-context"
import { client } from "@/lib/client"

import { newChatDirectory } from "../new-chat-directory"

const originalContext = client.state.projectContext
afterEach(() => client.store.setState({ projectContext: originalContext }))

test.each([
  null,
  "/Users/mac/Documents/Codex/project",
  "/Users/mac/Documents/ALwith",
  String.raw`C:\Users\Alice\Documents\Codex\project`
])("new chat from %s requests the host's default workspace", (cwd) => {
  client.store.setState({ projectContext: projectContext(cwd?.startsWith("C:") ? "C:/Users/Alice" : "/Users/mac") })
  expect(newChatDirectory(cwd)).toBeNull()
})

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
  client.store.setState({ projectContext: projectContext(cwd?.startsWith("C:") ? "C:/Users/Alice" : "/Users/mac") })
  expect(newChatDirectory(cwd)).toBe(cwd)
})
