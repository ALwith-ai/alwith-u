import type { DriveContentHost } from "@alwith/module-drive/content"
import { commands } from "@alwith/module-editor/commands"
import { type NativeSpreadsheetWorkbook, type PreviewHost } from "@alwith/module-editor/previews"
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url"

import { scopedDrivePreviewProviders } from "@/features/drive/preview-providers"

async function parseSpreadsheet(
  bytes: Uint8Array,
  signal?: AbortSignal,
  path?: string
): Promise<NativeSpreadsheetWorkbook> {
  signal?.throwIfAborted()
  if (!path) throw new Error("Spreadsheet path is required to identify the format")
  const extension = path.split(".").at(-1)!.toLowerCase()
  const result = await commands.parseSpreadsheet({ bytes: [...bytes], extension })
  signal?.throwIfAborted()
  return result
}
export function localPreviewProviders(
  host: Omit<PreviewHost, "pdfWorkerSrc" | "parseSpreadsheet">,
  contentHost: DriveContentHost
) {
  return scopedDrivePreviewProviders({ ...host, pdfWorkerSrc, parseSpreadsheet }, contentHost)
}
