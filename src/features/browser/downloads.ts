import { createStore } from "zustand/vanilla"

/** A download that has ended. Kept across restarts so the user can find the file again. */
export interface DownloadRecord {
  url: string
  /** Where the file was saved; empty when nothing was written. */
  path: string
  state: "finished" | "canceled" | "failed"
  at: number
}

const key = "alwith.browser.downloads.v1"
const limit = 100
const states = new Set(["finished", "canceled", "failed"])

function decode(raw: string): DownloadRecord[] {
  const value: unknown = JSON.parse(raw)
  if (
    !Array.isArray(value) ||
    !value.every((entry: unknown) => {
      if (typeof entry !== "object" || entry === null) return false
      const { url, path, state, at } = entry as Record<string, unknown>
      return typeof url === "string" && typeof path === "string" && states.has(state as string) && Number.isFinite(at)
    })
  )
    throw new Error("Invalid browser downloads")
  return value as DownloadRecord[]
}

export function loadDownloads(storage: Pick<Storage, "getItem"> = localStorage): DownloadRecord[] {
  const raw = storage.getItem(key)
  return raw === null ? [] : decode(raw)
}

/** The newest download comes first; the oldest fall off the end. */
export function addDownload(records: readonly DownloadRecord[], record: DownloadRecord): DownloadRecord[] {
  return [record, ...records].slice(0, limit)
}

export const downloadStore = createStore<DownloadRecord[]>(() => loadDownloads())
downloadStore.subscribe((records) => localStorage.setItem(key, JSON.stringify(records)))

export const recordDownload = (record: DownloadRecord) =>
  downloadStore.setState((records) => addDownload(records, record), true)
/** Forgets the list only; the files stay where they are. */
export const clearDownloads = () => downloadStore.setState([], true)
