import * as XLSX from "xlsx"
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<Uint8Array>) => void) | null
  postMessage: (message: { book?: XLSX.WorkBook; error?: string }) => void
}
scope.onmessage = event => {
  try {
    const book = XLSX.read(event.data, { type: "array", cellHTML: false, cellFormula: false, cellStyles: false })
    scope.postMessage({ book })
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : String(error) })
  }
}
