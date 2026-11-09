import type * as acp from "@agentclientprotocol/sdk/experimental/v2/unstable"
import { beforeEach, expect, test, vi } from "vitest"

import { commands } from "@/bindings"

import { prepareImageEdit } from "../prepare-edit"

vi.mock("@/bindings", () => ({ commands: { imagesPrepareReferences: vi.fn() } }))

beforeEach(() => vi.clearAllMocks())

test("preview edits use the selected service and count UTF-8 instructions outside image data", async () => {
  const prompt: acp.ContentBlock[] = [
    { type: "image", mimeType: "image/png", data: "b3JpZw==" },
    { type: "image", mimeType: "image/png", data: "bWFyaw==" },
    { type: "text", text: "保留透明通道，修改标记位置" }
  ]
  vi.mocked(commands.imagesPrepareReferences).mockResolvedValue([
    "data:image/png;base64,b3JpZw==",
    "data:image/webp;base64,Y29weQ=="
  ])
  const meta = { alwith: { imageIntent: "edit" } }
  const prepared = await prepareImageEdit(prompt, "target-session", "doubao-seedream-5-0-pro-260628", meta)
  expect(commands.imagesPrepareReferences).toHaveBeenCalledWith({
    input: {
      model: "doubao-seedream-5-0-pro-260628",
      images: ["data:image/png;base64,b3JpZw==", "data:image/png;base64,bWFyaw=="],
      envelopeBytes: new TextEncoder().encode(
        JSON.stringify({
          sessionId: "target-session",
          prompt: [
            { type: "image", mimeType: "image/png", data: "" },
            { type: "image", mimeType: "image/png", data: "" },
            prompt[2]
          ],
          _meta: meta
        })
      ).byteLength
    }
  })
  expect(prepared).toEqual([prompt[0], { type: "image", mimeType: "image/webp", data: "Y29weQ==" }, prompt[2]])
  expect(prompt[1]).toEqual({ type: "image", mimeType: "image/png", data: "bWFyaw==" })
})

test("ordinary chat uses the ACP budget and a native preparation error prevents sending", async () => {
  vi.mocked(commands.imagesPrepareReferences).mockRejectedValue(new Error("Cannot prepare image"))
  await expect(
    prepareImageEdit([{ type: "image", mimeType: "image/png", data: "b3JpZw==" }], "native-chat", null, {})
  ).rejects.toThrow("Cannot prepare image")
  expect(vi.mocked(commands.imagesPrepareReferences).mock.calls[0][0].input.model).toBeNull()
})
