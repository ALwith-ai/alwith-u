/** Give the standalone SVG intrinsic dimensions instead of Mermaid's percentage width. */
export function diagramImage(svg: string): { src: string; width: number; height: number } {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml")
  const root = document.documentElement
  const box = root
    .getAttribute("viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map(Number)
  if (root.localName !== "svg" || !box || box.length !== 4 || !box.every(Number.isFinite) || box[2] <= 0 || box[3] <= 0)
    throw new Error("Mermaid SVG has no valid viewBox")
  const [, , width, height] = box
  root.setAttribute("xmlns", "http://www.w3.org/2000/svg")
  root.setAttribute("width", String(width))
  root.setAttribute("height", String(height))
  root.style.removeProperty("max-width")
  return {
    src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(root))}`,
    width,
    height
  }
}

/** Rasterize at 2x resolution, bounding memory use for very large diagrams. */
export async function diagramPng(svg: string, background: string): Promise<string> {
  await document.fonts.ready
  const { src, width, height } = diagramImage(svg)
  const image = new Image()
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error("无法读取 Mermaid 图表"))
    image.src = src
  })
  const scale = Math.min(2, 8192 / width, 8192 / height, Math.sqrt(16_777_216 / (width * height)))
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.ceil(width * scale))
  canvas.height = Math.max(1, Math.ceil(height * scale))
  const context = canvas.getContext("2d")
  if (!context) throw new Error("无法创建 PNG 画布")
  context.fillStyle = background
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const data = canvas.toDataURL("image/png")
  if (!data.startsWith("data:image/png;base64,")) throw new Error("PNG 导出失败")
  return data.slice("data:image/png;base64,".length)
}
