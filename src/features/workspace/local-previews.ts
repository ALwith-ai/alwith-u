import {
  createPreviewProviders,
  type NativeSpreadsheetWorkbook,
  type PreviewHost
} from "@alwith/module-editor/previews"
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url"

import { commands } from "@/bindings"
async function parseSpreadsheet(
  bytes: Uint8Array,
  signal?: AbortSignal,
  path?: string
): Promise<NativeSpreadsheetWorkbook> {
  signal?.throwIfAborted()
  if (!path) throw new Error("Spreadsheet path is required to identify the format")
  const extension = path.split(".").at(-1)!.toLowerCase()
  const result = await commands.parseSpreadsheet({ bytes: Array.from(bytes), extension })
  signal?.throwIfAborted()
  return result
}
export function localPreviewProviders(host: Omit<PreviewHost, "pdfWorkerSrc" | "parseSpreadsheet">) {
  return createPreviewProviders({ ...host, pdfWorkerSrc, parseSpreadsheet })
}
