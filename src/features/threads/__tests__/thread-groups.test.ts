import { expect, test } from "vitest"
import { groupThreads, isQuickChatDirectory, QUICK_CHATS_GROUP } from "../thread-groups"

test.each([
  "/Users/alice/Documents/Codex",
  "/Users/alice/Documents/Codex/project",
  "/Users/alice/Documents/Codex/2026-09-23/nested/",
  "/Users/bob/Documents/ALwith U/",
  "/private/var/folders",
  "/private/var/folders/example/T/project",
  "/var/folders/",
  "/var/folders/example/T/project/nested/",
  "C:\\Users\\Alice\\Documents\\Codex",
  "C:\\Users\\Alice\\Documents\\Codex\\project",
  "c:/users/Alice/documents/CODEX/2026-09-23/nested/",
  "c:/users/Bob/documents/ALWITH U/",
  String.raw`C:\Users\Alice\AppData\Local\Temp`,
  String.raw`C:\Users\Alice\AppData\Local\Temp\project\nested`,
  "c:/USERS/Alice/AppData/LOCAL/TEMP/project/",
  String.raw`C:\Windows\Temp\project`,
  String.raw`\\?\C:\Users\Alice\AppData\Local\Temp\project`
])("%s belongs to quick chats", cwd => {
  expect(isQuickChatDirectory(cwd)).toBe(true)
})

test.each([
  "/Users/alice/Documents/ALwith U/project",
  "C:\\Users\\Alice\\Documents\\ALwith U\\project",
  "/Users/alice/Documents/Codex-other",
  "C:\\Users\\Alice\\Documents\\Codex-other\\project",
  "/work/Codex",
  "/Users/alice/Documents/codex",
  String.raw`C:\Users\Alice\AppData\Local\Temp-project`,
  String.raw`C:\Windows\Template`,
  String.raw`C:\projects\Temp\project`,
  "/private/var/folders-other/project",
  "/var/folders-other/project",
  "/private/var/project",
  "/var/project"
])("%s remains an independent project", cwd => {
  expect(isQuickChatDirectory(cwd)).toBe(false)
})

test("quick chats stays first even when empty and grouping preserves each original cwd", () => {
  expect(groupThreads([])).toEqual([[QUICK_CHATS_GROUP, []]])
  const paths = [
    "/project",
    "/Users/mac/Documents/Codex",
    "C:\\Users\\mac\\Documents\\ALwith U",
    "/private/var/folders/example/T/project",
    "/var/folders/example/T/project"
  ]
  const threads = paths.map((cwd, index) => ({
    sessionId: String(index),
    cwd,
    title: null,
    updatedAt: null,
    archived: false
  }))
  const groups = groupThreads(threads)
  expect(groups.map(([key]) => key)).toEqual([QUICK_CHATS_GROUP, "/project"])
  expect(groups[0]?.[1]).toEqual(threads.slice(1))
  expect(threads.map(thread => thread.cwd)).toEqual(paths)
})

test.each([
  ["D:/Scratch/", String.raw`d:\scratch\project\nested`, true],
  [String.raw`D:\Scratch`, "D:/SCRATCH/", true],
  [String.raw`D:\Scratch`, String.raw`D:\Scratch-other\project`, false],
  [String.raw`\\server\share\Temp`, String.raw`\\?\UNC\server\share\Temp\project`, true],
  [String.raw`\\server\share\Temp`, String.raw`\\server\share\Temp-old\project`, false]
])("uses the actual Windows temporary root %s for %s", (root, cwd, expected) => {
  expect(isQuickChatDirectory(cwd, root)).toBe(expected)
})

test("custom temporary paths join quick chats without changing the session cwd", () => {
  const thread = {
    sessionId: "temporary",
    cwd: String.raw`D:\Scratch\project`,
    title: null,
    updatedAt: null,
    archived: false
  }
  const groups = groupThreads([thread], String.raw`D:\Scratch`)
  expect(groups).toEqual([[QUICK_CHATS_GROUP, [thread]]])
  expect(groups[0]?.[1][0]).toBe(thread)
})
