import { getIdentifier } from "@tauri-apps/api/app"
import { arch, platform } from "@tauri-apps/plugin-os"
import { expect, test, vi } from "vitest"

import { registrationContext } from "../registration-context"

vi.mock("@tauri-apps/api/app", () => ({ getIdentifier: vi.fn() }))
vi.mock("@tauri-apps/plugin-os", () => ({ platform: vi.fn(), arch: vi.fn() }))

test.each(["macos", "windows", "linux"] as const)("registration identifies the actual %s host", async (channel) => {
  vi.mocked(platform).mockReturnValue(channel)
  vi.mocked(arch).mockReturnValue("x86_64")
  vi.mocked(getIdentifier).mockResolvedValue("test.alwith.u.custom")
  expect(await registrationContext("existing-device")).toEqual({
    channel,
    bundle_id: "test.alwith.u.custom",
    client_type: "DESKTOP",
    client_name: `Tauri-${channel}-x86_64`,
    device_id: "existing-device"
  })
})

test("unsupported hosts cannot silently register as another platform", async () => {
  vi.mocked(platform).mockReturnValue("freebsd")
  await expect(registrationContext("existing-device")).rejects.toThrow("Unsupported desktop registration platform")
})
