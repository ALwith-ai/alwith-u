import { defineApplicationTool } from "@alwith/module-chat/client"
import { imageModel, type ImageSelection, imageToolSet } from "@alwith/module-chat/image"

import type { ClientOptions } from "./client"
import { imageGenerationPrompt, type ImageRequestAspect } from "./image-request"

export type ImageToolRequest = {
  selection: ImageSelection
  references: Map<string, string>
  aspect?: ImageRequestAspect
}

export function createImageTool(
  service: NonNullable<ClientOptions["imageService"]>,
  request: (id: string) => ImageToolRequest | undefined
) {
  return defineApplicationTool({
    ...imageToolSet.definitions[0],
    revision: imageToolSet.revision,
    autoApprove: (sessionId) => request(sessionId) !== undefined,
    parse(input: unknown) {
      const args = input as { prompt?: unknown; references?: unknown }
      if (
        !args ||
        typeof args !== "object" ||
        Array.isArray(args) ||
        typeof args.prompt !== "string" ||
        !args.prompt.trim() ||
        Object.keys(args).some((key) => key !== "prompt" && key !== "references") ||
        (args.references !== undefined &&
          (!Array.isArray(args.references) || args.references.some((ref) => typeof ref !== "string")))
      )
        throw new Error("Invalid image instructions or references")
      return { prompt: args.prompt, references: args.references as string[] | undefined }
    },
    async execute(args, { sessionId, toolCallId, signal, agent }) {
      const snapshot = request(sessionId)
      if (!snapshot) throw new Error("Image request is no longer active")
      const ids = args.references as string[] | undefined
      const images = (ids ?? [...snapshot.references.keys()].filter((id) => id.startsWith("attachment:"))).map((id) => {
        const image = snapshot.references.get(id)
        if (!image) throw new Error(`Unknown image reference: ${id}`)
        return image
      })
      const model = imageModel(snapshot.selection)
      if (images.length > model.maxReferences) throw new Error(`This model supports ${model.maxReferences} references`)
      const prompt = imageGenerationPrompt(args.prompt, snapshot.aspect)
      const result: { images: { mimeType: string; data: string }[] } =
        model.provider === "chatgpt"
          ? await agent.request("_codex/images/generate", { prompt, images }, { cancellationSignal: signal })
          : await service.generateExternal(snapshot.selection, prompt, images, signal)
      signal.throwIfAborted()
      if (request(sessionId) !== snapshot) throw new Error("Image request was cancelled or replaced")
      result.images.forEach((image, index) =>
        snapshot.references.set(`${String(toolCallId)}:${index + 1}`, `data:${image.mimeType};base64,${image.data}`)
      )
      return {
        success: true,
        contentItems: [
          {
            type: "text",
            text: JSON.stringify({
              kind: "alwith.image",
              version: 1,
              model: model.id,
              size: snapshot.selection.size,
              displayed: true,
              message:
                "The application already displays these images and provides downloads. Finish with the returned image reference; do not regenerate, echo image data or write files to deliver this result.",
              references: ids ?? [],
              images: result.images.map((_, index) => ({ reference: `${String(toolCallId)}:${index + 1}` }))
            })
          },
          ...result.images.map((image) => ({ type: "image" as const, ...image }))
        ]
      }
    }
  })
}
