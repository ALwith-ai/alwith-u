import { afterEach, expect, spyOn, test } from "bun:test"
import * as opener from "@tauri-apps/plugin-opener"
import { openExternal } from "../open"

afterEach(() => {
  path.mockRestore()
  url.mockRestore()
})
let path: ReturnType<typeof spyOn<typeof opener, "openPath">>
let url: ReturnType<typeof spyOn<typeof opener, "openUrl">>

function spies(): void {
  path = spyOn(opener, "openPath").mockResolvedValue()
  url = spyOn(opener, "openUrl").mockResolvedValue()
}

test("local files and Markdown line locations use the native path opener", async () => {
  spies()
  await openExternal("file:///tmp/report%20one.pdf")
  await openExternal("/tmp/source.ts:12:3")
  await openExternal("C:\\project\\source.ts#L12")
  await openExternal("file:///tmp/source.ts:12:3")
  await openExternal("/tmp/report%20one.pdf")
  await openExternal("/tmp/100%.pdf")
  expect(path.mock.calls).toEqual([
    ["/tmp/report one.pdf"],
    ["/tmp/source.ts"],
    ["C:\\project\\source.ts"],
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
