import * as opener from "@tauri-apps/plugin-opener"
import { afterEach, expect, type MockInstance, test, vi } from "vitest"

import { openExternal, revealInFileManager } from "../open"

vi.mock("@tauri-apps/plugin-opener", async (importOriginal) => ({ ...(await importOriginal<object>()) }))

afterEach(() => {
  path.mockRestore()
  url.mockRestore()
})
let path: MockInstance<typeof opener.openPath>
let url: MockInstance<typeof opener.openUrl>

function spies(): void {
  path = vi.spyOn(opener, "openPath").mockResolvedValue()
  url = vi.spyOn(opener, "openUrl").mockResolvedValue()
}

test("local files and Markdown line locations use the native path opener", async () => {
  spies()
  await openExternal("file:///tmp/report%20one.pdf")
  await openExternal("/tmp/source.ts:12:3")
  await openExternal(String.raw`C:\project\source.ts#L12`)
  await openExternal("file:///tmp/source.ts:12:3")
  await openExternal("/tmp/report%20one.pdf")
  await openExternal("/tmp/100%.pdf")
  expect(path.mock.calls).toEqual([
    ["/tmp/report one.pdf"],
    ["/tmp/source.ts"],
    [String.raw`C:\project\source.ts`],
    ["/tmp/source.ts"],
    ["/tmp/report one.pdf"],
    ["/tmp/100%.pdf"]
  ])
  expect(url).not.toHaveBeenCalled()
})

test("web links retain the URL opener and opener errors propagate", async () => {
  spies()
  await openExternal("https://example.com/report.pdf")
  expect(url).toHaveBeenCalledWith("https://example.com/report.pdf")
  path.mockRejectedValue(new Error("File unavailable"))
  await expect(openExternal("/tmp/missing.pdf")).rejects.toThrow("File unavailable")
})

test.each([
  [
    String.raw`\\?\C:\Users\finture\YUP Drive\我的空间\项目\专项分析`,
    String.raw`C:\Users\finture\YUP Drive\我的空间\项目\专项分析`
  ],
  [String.raw`\\?\UNC\server\share\专项分析`, String.raw`\\server\share\专项分析`],
  ["C:/YUP Drive/专项分析", String.raw`C:\YUP Drive\专项分析`],
  ["/tmp/100% report#1:12.txt", "/tmp/100% report#1:12.txt"]
])("reveals the literal shell path for %s", async (input, expected) => {
  spies()
  const reveal = vi.spyOn(opener, "revealItemsInDir").mockResolvedValue()
  try {
    await revealInFileManager(input)
    expect(reveal).toHaveBeenCalledExactlyOnceWith(expected)
    reveal.mockRejectedValue(new Error("File unavailable"))
    await expect(revealInFileManager(input)).rejects.toThrow("File unavailable")
  } finally {
    reveal.mockRestore()
  }
})

test("external opening converts Windows verbatim and UNC paths for the shell", async () => {
  spies()
  await openExternal(String.raw`\\?\C:\YUP Drive\专项分析`)
  await openExternal(String.raw`\\?\UNC\server\share\专项分析`)
  expect(path.mock.calls).toEqual([[String.raw`C:\YUP Drive\专项分析`], [String.raw`\\server\share\专项分析`]])
  expect(url).not.toHaveBeenCalled()
})
