import type {
  SpreadsheetBook,
  SpreadsheetCell_Serialize as SpreadsheetCell,
  SpreadsheetRow_Serialize as SpreadsheetRow,
  SpreadsheetSheet,
  SpreadsheetWindow_Serialize as SpreadsheetWindow
} from "@alwith/module-editor/commands"
import * as XLSX from "xlsx"

// The host decodes a workbook and answers its sheets by window, as `alwith-editor` does. SheetJS reads the
// values and merges; cell styles are not decoded here, so every window carries an empty style table.
const MAX_WINDOW_CELLS = 1_000_000
const books = new Map<number, XLSX.WorkBook>()
let nextBook = 1
export function resetSpreadsheets(): void {
  books.clear()
}
function worksheet(id: number, index: number): XLSX.WorkSheet {
  const book = books.get(id)
  if (!book) throw new Error(`Unknown spreadsheet: ${id}`)
  const name = book.SheetNames[index]
  if (name === undefined) throw new Error(`No worksheet ${index}`)
  return book.Sheets[name]
}
function extent(sheet: XLSX.WorkSheet): SpreadsheetSheet {
  const merges = (sheet["!merges"] ?? []).map(
    (merge) => [merge.s.r, merge.s.c, merge.e.r, merge.e.c] as [number, number, number, number]
  )
  const range = sheet["!ref"] === undefined ? null : XLSX.utils.decode_range(sheet["!ref"])
  return {
    rowCount: Math.max(range === null ? 0 : range.e.r + 1, ...merges.map((merge) => merge[2] + 1)),
    columnCount: Math.max(range === null ? 0 : range.e.c + 1, ...merges.map((merge) => merge[3] + 1)),
    merges
  }
}
function cell(value: XLSX.CellObject): SpreadsheetCell {
  if (value.t === "e") return { text: String(value.w), number: null, style: null }
  return { text: String(value.v), number: value.t === "n" ? (value.v as number) : null, style: null }
}
export function spreadsheetCommand(
  command: string,
  args: Record<string, unknown>,
  read: (address: string) => Uint8Array
): unknown {
  if (command === "plugin:alwith-editor|spreadsheet_open") {
    const book = XLSX.read(read(String(args.address)), { type: "array" })
    if (book.SheetNames.length === 0) throw new Error("No worksheet found")
    const id = nextBook++
    books.set(id, book)
    return {
      id,
      sheets: book.SheetNames,
      date1904: book.Workbook?.WBProps?.date1904 === true
    } satisfies SpreadsheetBook
  }
  const id = args.id as number
  if (command === "plugin:alwith-editor|spreadsheet_sheet") return extent(worksheet(id, args.sheet as number))
  if (command === "plugin:alwith-editor|spreadsheet_window") {
    const {
      sheet: index,
      row,
      rows,
      column,
      columns
    } = args as Record<"sheet" | "row" | "rows" | "column" | "columns", number>
    if (rows * columns > MAX_WINDOW_CELLS)
      throw new Error(`A spreadsheet window spans at most ${MAX_WINDOW_CELLS} cells`)
    const sheet = worksheet(id, index)
    const { rowCount, columnCount } = extent(sheet)
    const window: SpreadsheetWindow = { rows: {}, styles: [] }
    for (let r = row; r < Math.min(row + rows, rowCount); r++)
      for (let c = column; c < Math.min(column + columns, columnCount); c++) {
        const value = sheet[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined
        if (value === undefined || value.t === "z") continue
        const target: SpreadsheetRow = (window.rows[r] ??= { cells: {} })
        target.cells[c] = cell(value)
      }
    return window
  }
  if (command === "plugin:alwith-editor|spreadsheet_close") {
    if (!books.delete(id)) throw new Error(`Unknown spreadsheet: ${id}`)
    return null
  }
  throw new Error(`Unimplemented Storybook spreadsheet boundary: ${command}`)
}
