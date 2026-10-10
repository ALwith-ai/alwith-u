import { createPreviewProviders, type PreviewHost, type SpreadsheetWorkbook } from "@alwith/module-editor/previews"
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url"
import SpreadsheetWorker from "./spreadsheet.worker?worker"

function parseSpreadsheet(bytes: Uint8Array, signal?: AbortSignal): Promise<SpreadsheetWorkbook> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Preview was closed", "AbortError"))
      return
    }
    const worker = new SpreadsheetWorker()
    const close = (): void => {
      worker.terminate()
      signal?.removeEventListener("abort", abort)
    }
    const abort = (): void => {
      close()
      reject(new DOMException("Preview was closed", "AbortError"))
    }
    signal?.addEventListener("abort", abort, { once: true })
    worker.onerror = event => {
      close()
      reject(new Error(event.message || "Spreadsheet worker failed"))
    }
    worker.onmessageerror = () => {
      close()
      reject(new Error("Invalid spreadsheet worker response"))
    }
    worker.onmessage = (event: MessageEvent<{ book?: SpreadsheetWorkbook; error?: string }>) => {
      close()
      if (event.data.error) reject(new Error(event.data.error))
      else if (event.data.book && Array.isArray(event.data.book.SheetNames)) resolve(event.data.book)
      else reject(new Error("Invalid spreadsheet worker response"))
    }
    const copy = bytes.slice()
    worker.postMessage(copy, [copy.buffer])
  })
}
export function localPreviewProviders(host: Omit<PreviewHost, "pdfWorkerSrc" | "parseSpreadsheet">) {
  return createPreviewProviders({ ...host, pdfWorkerSrc, parseSpreadsheet })
}
