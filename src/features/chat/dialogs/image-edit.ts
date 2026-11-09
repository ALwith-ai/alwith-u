import type * as acp from "@agentclientprotocol/sdk/experimental/v2/unstable"

export type EditMode = "annotate" | "comment" | "background" | "erase" | "resize"
export const IMAGE_ASPECT_RATIOS = [
  { value: "1:1", label: "square" },
  { value: "3:4", label: "portrait" },
  { value: "9:16", label: "story" },
  { value: "4:3", label: "landscape" },
  { value: "16:9", label: "widescreen" }
] as const
export type ImageAspectRatio = (typeof IMAGE_ASPECT_RATIOS)[number]["value"]
export type Point = { x: number; y: number }
export type ImageComment = { id: string; point: Point; text: string }
export type Stroke = { tool: "pen" | "rectangle" | "arrow"; points: Point[]; width: number; color: string }
export type ImageEditRequest = {
  mode: EditMode
  source: string
  overlay?: string
  instruction: string
  aspectRatio?: ImageAspectRatio
  operationText?: string
  comments?: ImageComment[]
}

export function imagePoint(x: number, y: number, bounds: Pick<DOMRect, "left" | "top" | "width" | "height">): Point {
  return {
    x: Math.max(0, Math.min(1, (x - bounds.left) / bounds.width)),
    y: Math.max(0, Math.min(1, (y - bounds.top) / bounds.height))
  }
}

/** Images remain separate ACP attachments: original first, reference or mask second. */
export function imageEditPrompt(request: ImageEditRequest): acp.ContentBlock[] {
  const { mode, source, overlay, instruction, aspectRatio, operationText, comments = [] } = request
  if ((mode === "annotate" || mode === "erase" || mode === "comment") && !overlay)
    throw new Error("The edit reference is missing")
  if (mode === "annotate" && !instruction.trim()) throw new Error("Describe how to edit the marked image")
  if (mode === "comment" && (comments.length === 0 || comments.some((comment) => !comment.text.trim())))
    throw new Error("Image comments are missing")
  if (mode === "resize" && !IMAGE_ASPECT_RATIOS.some((ratio) => ratio.value === aspectRatio))
    throw new Error("Invalid image aspect ratio")
  const prompt: acp.ContentBlock[] = []
  for (const url of [source, ...(overlay ? [overlay] : [])]) {
    const match = /^data:(image\/[^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(url)
    if (!match) throw new Error("Image data is unavailable")
    prompt.push({ type: "image", mimeType: match[1], data: match[2] })
  }
  const instructions: Record<EditMode, string> = {
    annotate:
      "Edit the first image according to the user's instructions. The second image is an annotated reference showing the relevant areas. Do not include the annotation marks in the result.",
    comment:
      "Edit the first image according to the numbered comments. The second image shows numbered pins locating each comment. Apply the requested changes and do not include pins or comment text in the result.",
    background:
      "Remove the background from this image. Preserve the subject and fine details, and return a PNG with a transparent background.",
    erase:
      "Remove the area marked in white in the second image from the first image. The second image is a mask: white marks the area to remove; black marks the area to preserve. Reconstruct the removed area naturally, keeping the rest unchanged.",
    resize: `Set the aspect ratio of this image to ${aspectRatio}. Preserve the subject proportions; extend or recompose the surrounding area as needed without stretching the subject. Return the edited image.`
  }
  prompt.push({
    type: "text",
    text: [
      operationText ?? instructions[mode],
      ...(mode === "comment"
        ? comments.map(
            (comment, index) =>
              `${index + 1}. (${Math.round(comment.point.x * 100)}%, ${Math.round(comment.point.y * 100)}%): ${comment.text.trim()}`
          )
        : []),
      ...(instruction.trim() ? [instruction.trim()] : [])
    ].join("\n\n")
  })
  return prompt
}

/** One geometry is used for the SVG preview and the exported canvas. */
export function strokePath(stroke: Stroke, width: number, height: number): string {
  const start = stroke.points[0]
  const end = stroke.points.at(-1)
  if (!start || !end) throw new Error("A stroke needs at least one point")
  const x = start.x * width,
    y = start.y * height,
    ex = end.x * width,
    ey = end.y * height
  if (stroke.tool === "rectangle") return `M${x} ${y}H${ex}V${ey}H${x}Z`
  if (stroke.tool === "arrow") {
    const angle = Math.atan2(ey - y, ex - x)
    const head = Math.min(Math.hypot(ex - x, ey - y) / 2, stroke.width * Math.min(width, height) * 5)
    return `M${x} ${y}L${ex} ${ey}M${ex - head * Math.cos(angle - Math.PI / 6)} ${ey - head * Math.sin(angle - Math.PI / 6)}L${ex} ${ey}L${ex - head * Math.cos(angle + Math.PI / 6)} ${ey - head * Math.sin(angle + Math.PI / 6)}`
  }
  // A tiny segment also makes a single brush click visible with round line caps.
  const segments =
    stroke.points.length === 1
      ? "l0.01 0"
      : stroke.points
          .slice(1)
          .map((point) => `L${point.x * width} ${point.y * height}`)
          .join("")
  return `M${x} ${y}${segments}`
}

export async function renderImageEdit(
  source: string,
  strokes: Stroke[],
  mask: boolean,
  comments: ImageComment[] = []
): Promise<string> {
  const image = new Image()
  image.src = source
  await image.decode()
  // Bound working memory while preserving the original attachment at its full resolution.
  const scale = Math.min(1, 4096 / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext("2d")
  if (!context) throw new Error("Image editing is unavailable")
  if (mask) {
    context.fillStyle = "black"
    context.fillRect(0, 0, canvas.width, canvas.height)
  } else context.drawImage(image, 0, 0, canvas.width, canvas.height)
  context.lineCap = "round"
  context.lineJoin = "round"
  for (const stroke of strokes) {
    context.strokeStyle = mask ? "white" : stroke.color
    context.lineWidth = stroke.width * Math.min(canvas.width, canvas.height)
    context.stroke(new Path2D(strokePath(stroke, canvas.width, canvas.height)))
  }
  const radius = Math.max(12, Math.min(canvas.width, canvas.height) * 0.018)
  comments.forEach((comment, index) => {
    const x = comment.point.x * canvas.width
    const y = comment.point.y * canvas.height
    context.beginPath()
    context.arc(x, y, radius, 0, Math.PI * 2)
    context.fillStyle = "#171717"
    context.fill()
    context.strokeStyle = "#ffffff"
    context.lineWidth = Math.max(2, radius * 0.12)
    context.stroke()
    context.fillStyle = "#ffffff"
    context.font = `600 ${Math.round(radius)}px sans-serif`
    context.textAlign = "center"
    context.textBaseline = "middle"
    context.fillText(String(index + 1), x, y)
  })
  return canvas.toDataURL("image/png")
}
