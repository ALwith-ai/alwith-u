import { isImage, type Session } from "@alwith/module-chat/client"
import type { Attachment, FileUIPart } from "@alwith/module-chat/composer-context"

/** Uploaded references are derived from native user messages and never stored in a second library. */
export function uploadedImageReferences(session: Pick<Session, "items">): Attachment[] {
  return session.items.flatMap((item) =>
    item.kind !== "user"
      ? []
      : item.content.flatMap((block, index): Attachment[] =>
          isImage(block)
            ? [
                {
                  id: `${item.id}:${index}`,
                  type: "file",
                  mediaType: block.mimeType,
                  url: `data:${block.mimeType};base64,${block.data}`
                }
              ]
            : []
        )
  )
}

export async function imageAttachmentContent(file: FileUIPart) {
  let source = file.url
  if (!source.startsWith("data:")) {
    const response = await fetch(source)
    if (!response.ok) throw new Error("Cannot read the image attachment")
    const blob = await response.blob()
    source = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(reader.error)
      reader.onload = () => resolve(String(reader.result))
      reader.readAsDataURL(blob)
    })
  }
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(source)
  if (!match) throw new Error("Unsupported image attachment")
  return { type: "image" as const, mimeType: match[1], data: match[2] }
}
