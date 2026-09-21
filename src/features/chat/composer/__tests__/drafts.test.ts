import { afterEach, expect, spyOn, test } from "bun:test"
import { installDom } from "../../codex/__tests__/dom-environment"
import { drafts, exportDraft, importDraft } from "../drafts"

installDom()
afterEach(() => drafts.clear())

test("cross-window drafts preserve text, mentions, model and materialize blob attachments", async () => {
  importDraft("draft", {
    text: "Explain this image",
    mentions: ["/tmp/example.ts"],
    modelId: "gateway/model",
    attachments: [
      { id: "image", type: "file", mediaType: "image/png", filename: "example.png", url: "blob:source-window" }
    ]
  })
  const fetchImage = spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(new Blob(["image"], { type: "image/png" }))
  )
  try {
    const transferred = await exportDraft("draft")
    expect(transferred?.text).toBe("Explain this image")
    expect(transferred?.mentions).toEqual(["/tmp/example.ts"])
    expect(transferred?.modelId).toBe("gateway/model")
    expect(transferred?.attachments[0].url).toBe("data:image/png;base64,aW1hZ2U=")
    expect(drafts.get("draft")?.attachments[0].url).toBe("blob:source-window")
    importDraft("destination", transferred)
    expect(await exportDraft("destination")).toEqual(transferred)
    importDraft("destination", null)
    expect(await exportDraft("destination")).toBeNull()
  } finally {
    fetchImage.mockRestore()
  }
})

test("an unreadable attachment fails the transfer without clearing the source draft", async () => {
  importDraft("draft", {
    text: "keep me",
    attachments: [{ id: "image", type: "file", mediaType: "image/png", url: "blob:missing" }],
    mentions: [],
    modelId: null
  })
  const fetchImage = spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 404 }))
  try {
    await expect(exportDraft("draft")).rejects.toThrow("Cannot read draft image")
    expect(drafts.get("draft")?.text).toBe("keep me")
  } finally {
    fetchImage.mockRestore()
  }
})
