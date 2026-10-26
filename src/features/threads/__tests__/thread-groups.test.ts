import { expect, test } from "vitest"

import { groupThreads, isQuickChatDirectory, QUICK_CHATS_GROUP } from "../thread-groups"

test.each([
  "/Users/alice/Documents/Codex",
  "/Users/alice/Documents/Codex/project",
  "/Users/alice/Documents/Codex/2026-09-23/nested/",
  "/Users/bob/Documents/ALwith/",
  "c:/users/Bob/documents/ALWITH/",
  String.raw`C:\Users\Alice\Documents\Codex`,
  String.raw`C:\Users\Alice\Documents\Codex\project`,
  "c:/users/Alice/documents/CODEX/2026-09-23/nested/"
])("%s belongs to quick chats", (cwd) => {
  expect(isQuickChatDirectory(cwd)).toBe(true)
})

test.each([
  "/Users/bob/Documents/ALwith U",
  "/Users/bob/Documents/ALwith U/",
  "c:/users/Bob/documents/ALWITH U/",
  String.raw`C:\Users\Alice\Documents\ALwith U`,
  String.raw`\\?\C:\Users\Alice\Documents\ALwith U`,
  "/private/var/folders",
  "/private/var/folders/example/T/project",
  "/var/folders/",
  "/var/folders/example/T/project/nested/",
  String.raw`C:\Users\Alice\AppData\Local\Temp`,
  String.raw`C:\Users\Alice\AppData\Local\Temp\project\nested`,
  "c:/USERS/Alice/AppData/LOCAL/TEMP/project/",
  String.raw`C:\Windows\Temp\project`,
  String.raw`\\?\C:\Users\Alice\AppData\Local\Temp\project`,
  String.raw`C:\Users\Alice\AppData\Local\Temp-project`,
  String.raw`C:\Windows\Template`,
  "/tmp/project",
  "/private/tmp/project",
  String.raw`D:\Scratch\project`,
  String.raw`\\server\share\Temp\project`,
  "/Users/alice/Documents/ALwith U/project",
  "/Users/alice/Documents/ALwith/project",
  "c:/users/Bob/documents/ALwith/project",
  String.raw`C:\Users\Alice\Documents\ALwith\project`,
  "/Users/alice/Documents/Codex-other",
  String.raw`C:\Users\Alice\Documents\Codex-other\project`,
  "/work/Codex",
  "/Users/alice/Documents/codex",
  String.raw`C:\projects\Temp\project`,
  "/private/var/folders-other/project",
  "/var/folders-other/project",
  "/private/var/project",
  "/var/project"
])("%s remains an independent project", (cwd) => {
  expect(isQuickChatDirectory(cwd)).toBe(false)
})

test("quick chats stays first even when empty and grouping preserves each original cwd", () => {
  expect(groupThreads([])).toEqual([[QUICK_CHATS_GROUP, []]])
  const paths = ["/project", "/Users/mac/Documents/Codex", String.raw`C:\Users\mac\Documents\ALwith`]
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
  expect(threads.map((thread) => thread.cwd)).toEqual(paths)
})

test("temporary directories form separate project groups and preserve the session cwd", () => {
  const paths = [
    "/private/var/folders/example/T/first",
    "/private/var/folders/example/T/second",
    String.raw`C:\Users\Alice\AppData\Local\Temp\project`,
    String.raw`D:\Scratch\project`
  ]
  const threads = paths.map((cwd, index) => ({
    sessionId: String(index),
    cwd,
    title: null,
    updatedAt: null,
    archived: false
  }))
  expect(groupThreads(threads)).toEqual([[QUICK_CHATS_GROUP, []], ...threads.map((thread) => [thread.cwd, [thread]])])
})
