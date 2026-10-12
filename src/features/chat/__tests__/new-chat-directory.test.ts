import { afterEach, expect, test } from "vitest"
import { useThreadsUiStore } from "@/features/threads/store"
import { newChatDirectory } from "../new-chat-directory"

const original = useThreadsUiStore.getState()
afterEach(() => useThreadsUiStore.setState(original, true))

test.each([
  null,
  "/Users/mac/Documents/Codex/project",
  "/Users/mac/Documents/ALwith U",
  "/private/var/folders/example/T/project",
  "/var/folders/example/T/project",
  String.raw`C:\Users\Alice\Documents\Codex\project`,
  String.raw`C:\Users\Alice\AppData\Local\Temp\project`,
  String.raw`C:\Windows\Temp\project`
])("new chat from %s requests the host's default workspace", cwd => {
  expect(newChatDirectory(cwd)).toBeNull()
})

test("uses the same configured temporary root as the sidebar without matching similar project names", () => {
  useThreadsUiStore.setState({ windowsTempDirectory: String.raw`D:\Scratch` })
  expect(newChatDirectory(String.raw`d:\scratch\project`)).toBeNull()
  expect(newChatDirectory(String.raw`D:\Scratch-project`)).toBe(String.raw`D:\Scratch-project`)
})

test.each(["/project", "/Users/mac/Documents/ALwith U/project", "/var/folders-other/project"])(
  "new chat retains the ordinary project %s",
  cwd => expect(newChatDirectory(cwd)).toBe(cwd)
)
