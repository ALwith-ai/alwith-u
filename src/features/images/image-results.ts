import {
  isContentEntry,
  isText,
  nativeTurnId,
  type Session,
  type ToolItem,
  type ToolNode,
  turns
} from "@alwith/module-chat/client"
import { imageArtifacts } from "@alwith/module-chat/image"

/** Host metadata distinguishes generation results from tools that merely inspect or echo an image. */
export function imageResultReferences(item: ToolItem): string[] | null {
  for (const entry of item.content.filter(isContentEntry)) {
    if (!isText(entry.content) || !entry.content.text.startsWith("{")) continue
    let value: unknown
    try {
      value = JSON.parse(entry.content.text.split("\n")[0]!)
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
      continue
    }
    if (
      !value ||
      typeof value !== "object" ||
      !("kind" in value) ||
      value.kind !== "alwith.image" ||
      !("images" in value) ||
      !Array.isArray(value.images)
    )
      continue
    return value.images.flatMap((image: unknown) =>
      image && typeof image === "object" && "reference" in image && typeof image.reference === "string"
        ? [image.reference]
        : []
    )
  }
  return null
}

/** Each image turn presents its final successful generation batch, including requested variants. */
export function imageResultBatches(session: Session) {
  const artifacts = imageArtifacts(session)
  const byTool = new Map<string, typeof artifacts>()
  for (const image of artifacts) {
    const images = byTool.get(image.toolId) ?? []
    images.push(image)
    byTool.set(image.toolId, images)
  }
  return turns(session).map((turn) => {
    const tool = turn.entries.findLast(
      (item): item is ToolNode =>
        item.kind === "tool" &&
        byTool.has(item.id) &&
        (imageResultReferences(item) !== null ||
          item.name === "image_generation" ||
          item.name === "alwith_client_generate_image")
    )
    const unique = new Set<string>()
    const images = (tool ? byTool.get(tool.id)! : []).filter((image) => {
      const key = `${image.mimeType}:${image.data}`
      if (unique.has(key)) return false
      unique.add(key)
      return true
    })
    return { turn, tool, images }
  })
}

/** The gallery uses the same successful results as the conversation, without tool echoes. */
export function generatedImages(session: Session) {
  return mergeGeneratedImages(
    [],
    imageResultBatches(session).flatMap(({ turn, tool, images }) =>
      images.map((image) => ({ ...image, turnId: nativeTurnId(tool!) ?? turn.prompt?.id ?? tool!.id }))
    )
  )
}

type GeneratedImage = ReturnType<typeof imageArtifacts>[number] & { turnId: string }

/** New results replace a cached intermediate batch for the same native turn. */
export function mergeGeneratedImages(previous: GeneratedImage[], incoming: GeneratedImage[]): GeneratedImage[] {
  const replaced = new Set(incoming.map((image) => image.turnId))
  const unique = new Set<string>()
  return [...previous.filter((image) => !replaced.has(image.turnId)), ...incoming].filter((image) => {
    const key = `${image.mimeType}:${image.data}`
    if (unique.has(key)) return false
    unique.add(key)
    return true
  })
}
