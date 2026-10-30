import { mkdir, writeFile } from "node:fs/promises"
// Reproducible, synthetic documents and media. No user or downloaded files are used.
import path from "node:path"

import JSZip from "jszip"
import { chromium } from "playwright"
import UTIF from "utif"
import * as XLSX from "xlsx"

const directory = path.join(import.meta.dirname, "assets")
await mkdir(directory, { recursive: true })
const write = (name, bytes) => writeFile(path.join(directory, name), bytes)
const pdfObjects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>",
  "BT /F1 22 Tf 35 240 Td (ALwith U - preview page 1) Tj ET",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>",
  "BT /F1 22 Tf 35 240 Td (ALwith U - preview page 2) Tj ET",
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
]
let pdf = "%PDF-1.4\n"
const offsets = [0]
pdfObjects.forEach((value, index) => {
  offsets.push(Buffer.byteLength(pdf))
  pdf += `${index + 1} 0 obj\n${index === 3 || index === 5 ? `<< /Length ${value.length} >>\nstream\n${value}\nendstream` : value}\nendobj\n`
})
const xref = Buffer.byteLength(pdf)
pdf += `xref\n0 8\n0000000000 65535 f \n${offsets
  .slice(1)
  .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
  .join("")}trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
await write("sample.pdf", pdf)
const word = new JSZip()
word.file(
  "[Content_Types].xml",
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
)
word.file(
  "_rels/.rels",
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
)
word.file(
  "word/document.xml",
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>ALwith U document preview</w:t></w:r></w:p><w:p><w:r><w:t>Synthetic delivery checklist. No personal data.</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>'
)
await write("sample.docx", await word.generateAsync({ type: "nodebuffer" }))
const book = XLSX.utils.book_new()
for (const name of ["Overview", "Details"])
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      ["Module", "Progress"],
      ["Chat", 80],
      ["Files", 65]
    ]),
    name
  )
await write("sample.xlsx", XLSX.write(book, { type: "buffer", bookType: "xlsx" }))
const rgba = new Uint8Array(64 * 64 * 4)
for (let i = 0; i < rgba.length; i += 4) rgba.set([70, 120 + (i % 80), 180, 255], i)
await write("sample.tiff", new Uint8Array(UTIF.encodeImage(rgba.buffer, 64, 64)))
const wave = Buffer.alloc(44 + 8000 * 2)
wave.write("RIFF")
wave.writeUInt32LE(wave.length - 8, 4)
wave.write("WAVEfmt ", 8)
wave.writeUInt32LE(16, 16)
wave.writeUInt16LE(1, 20)
wave.writeUInt16LE(1, 22)
wave.writeUInt32LE(8000, 24)
wave.writeUInt32LE(16000, 28)
wave.writeUInt16LE(2, 32)
wave.writeUInt16LE(16, 34)
wave.write("data", 36)
wave.writeUInt32LE(wave.length - 44, 40)
for (let i = 0; i < 8000; i++) wave.writeInt16LE(Math.round(Math.sin((i * Math.PI * 440) / 4000) * 600), 44 + i * 2)
await write("sample.wav", wave)
await write(
  "wallpaper.svg",
  '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#e1e8ec"/><circle cx="900" cy="250" r="300" fill="#bacbd3"/><circle cx="300" cy="650" r="350" fill="#c3d8ce"/></svg>'
)
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement("canvas")
    canvas.width = 320
    canvas.height = 180
    const context = canvas.getContext("2d")
    context.fillStyle = "#e1e8ec"
    context.fillRect(0, 0, 320, 180)
    const stream = canvas.captureStream(10)
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" })
    const chunks = []
    recorder.ondataavailable = (event) => chunks.push(event.data)
    const finished = new Promise((resolve) => {
      recorder.onstop = resolve
    })
    recorder.start()
    for (let frame = 0; frame < 10; frame++) {
      context.fillStyle = "#e1e8ec"
      context.fillRect(0, 0, 320, 180)
      context.fillStyle = "#344054"
      context.font = "22px sans-serif"
      context.fillText(`ALwith U - frame ${frame + 1}`, 25, 95)
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    recorder.stop()
    await finished
    stream.getTracks().forEach((track) => track.stop())
    return [...new Uint8Array(await new Blob(chunks, { type: "video/webm" }).arrayBuffer())]
  })
  await write("sample.webm", new Uint8Array(bytes))
} finally {
  await browser.close()
}
console.log("Created seven synthetic preview assets")
