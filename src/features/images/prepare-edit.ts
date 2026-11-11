import type * as acp from "@agentclientprotocol/sdk/experimental/v2/unstable"
import { isImage } from "@alwith/module-chat/client"

import { commands } from "@/bindings"

/** Native preparation uses the selected provider's budgets and never changes gallery/download sources. */
export async function prepareImageEdit(
  prompt: acp.ContentBlock[],
  sessionId: string,
  model: string | null,
  meta: Record<string, unknown>
): Promise<acp.ContentBlock[]> {
  const envelopeBytes = new TextEncoder().encode(
    JSON.stringify({
      sessionId,
      prompt: prompt.map((block) => (isImage(block) ? { ...block, data: "" } : block)),
      _meta: meta
    })
  ).byteLength
  const images = await commands.imagesPrepareReferences({
    input: {
      model,
      images: prompt.flatMap((block) => (isImage(block) ? [`data:${block.mimeType};base64,${block.data}`] : [])),
      envelopeBytes
    }
  })
  let index = 0
  return prompt.map((block) => {
    if (!isImage(block)) return block
    const image = images[index++]
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(image)
    if (!match) throw new Error("Invalid prepared image data")
    return { ...block, mimeType: match[1], data: match[2] }
  })
}
