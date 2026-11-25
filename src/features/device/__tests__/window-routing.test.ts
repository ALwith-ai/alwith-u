import { beforeEach, expect, test, vi } from "vitest"

const prompt = vi.fn<(sessionId: string, blocks: unknown[]) => Promise<string>>()
vi.mock("@/lib/client", () => ({ client: { prompt: (...args: Parameters<typeof prompt>) => prompt(...args) } }))

const { sendDeviceRemark } = await import("../window-routing")

beforeEach(() => {
  prompt.mockReset().mockResolvedValue("message-1")
})

test("what a person said about the device's screen goes to its conversation with what they pointed at attached", async () => {
  const context =
    "指着“发送”\ndevice: iPhone 17 (ios, ABCD)\nelement: Button\nframe: x 100, y 200, width 200, height 100"
  await sendDeviceRemark("session-1", "改成蓝色", context)
  expect(prompt).toHaveBeenCalledExactlyOnceWith("session-1", [
    { type: "text", text: "改成蓝色" },
    { type: "resource", resource: { uri: "device:screen", mimeType: "text/plain", text: context } }
  ])
})

test("a remark that could not be delivered is reported to whoever sent it", async () => {
  prompt.mockRejectedValue(new Error("offline"))
  await expect(sendDeviceRemark("session-1", "改成蓝色", "指着这一处")).rejects.toThrow("offline")
})
