import { expect, test } from "vitest"

import { addDownload, type DownloadRecord, loadDownloads } from "../downloads"

const record = (at: number): DownloadRecord => ({
  url: `https://a.example/f/${at}.zip`,
  path: `/Users/me/Downloads/${at}.zip`,
  state: "finished",
  at
})

test("the newest download comes first and the list is bounded", () => {
  let records: DownloadRecord[] = []
  for (let at = 0; at < 130; at++) records = addDownload(records, record(at))
  expect(records).toHaveLength(100)
  expect(records[0]!.at).toBe(129)
  expect(records.at(-1)!.at).toBe(30)
})

test("a saved list is read back, and a damaged one is refused rather than guessed at", () => {
  const stored = (value: unknown) => ({ getItem: () => JSON.stringify(value) })
  expect(loadDownloads({ getItem: () => null })).toEqual([])
  expect(loadDownloads(stored([record(1)]))).toEqual([record(1)])
  expect(() => loadDownloads(stored([{ ...record(1), state: "progress" }]))).toThrow("Invalid browser downloads")
  expect(() => loadDownloads(stored({ downloads: [] }))).toThrow("Invalid browser downloads")
})
