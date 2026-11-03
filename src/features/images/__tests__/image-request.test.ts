import { createSession } from "@alwith/module-chat/client"
import { expect, test } from "vitest"

import { imageAttachmentContent, uploadedImageReferences } from "../image-request"

test("upload choices come from native user messages and retain each attachment identity", () => {
  const session = createSession("images", "/tmp")
  session.items = [
    {
      kind: "user",
      id: "upload",
      at: 1,
      replayed: true,
      _meta: null,
      echo: null,
      content: [
        { type: "text", text: "Edit this" },
        { type: "image", mimeType: "image/png", data: "b3JpZw==" }
      ]
    },
    {
      kind: "assistant",
      id: "answer",
      at: 2,
      replayed: true,
      _meta: null,
      echo: null,
      content: [{ type: "image", mimeType: "image/png", data: "bmV3" }]
    }
  ]
  expect(uploadedImageReferences(session)).toEqual([
    { id: "upload:1", type: "file", mediaType: "image/png", url: "data:image/png;base64,b3JpZw==" }
  ])
})

test("image attachments remain real ACP image blocks and reject unreadable references", async () => {
  await expect(
    imageAttachmentContent({ type: "file", url: "data:image/png;base64,b3JpZw==", mediaType: "image/png" })
  ).resolves.toEqual({ type: "image", mimeType: "image/png", data: "b3JpZw==" })
  await expect(
    imageAttachmentContent({ type: "file", url: "data:text/plain;base64,b3JpZw==", mediaType: "image/png" })
  ).rejects.toThrow("Unsupported image attachment")
})
