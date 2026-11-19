import type { DriveContentHost } from "@alwith/module-drive/content"
import { type PreviewHost } from "@alwith/module-editor/previews"
import { openNativeSpreadsheet } from "@alwith/module-editor/spreadsheet/native"
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url"

import { scopedDrivePreviewProviders } from "@/features/drive/preview-providers"

export function localPreviewProviders(
  host: Omit<PreviewHost, "pdfWorkerSrc" | "openSpreadsheet">,
  contentHost: DriveContentHost
) {
  // Workbooks are decoded by the native editor library and read by window from the file's address.
  return scopedDrivePreviewProviders({ ...host, pdfWorkerSrc, openSpreadsheet: openNativeSpreadsheet }, contentHost)
}
