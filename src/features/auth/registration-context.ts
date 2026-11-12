import { getIdentifier } from "@tauri-apps/api/app"
import { arch, platform } from "@tauri-apps/plugin-os"

export async function registrationContext(deviceId: string) {
  const channel = platform()
  if (channel !== "macos" && channel !== "windows" && channel !== "linux")
    throw new Error(`Unsupported desktop registration platform: ${channel}`)
  return {
    channel,
    bundle_id: await getIdentifier(),
    client_type: "DESKTOP",
    client_name: `Tauri-${channel}-${arch()}`,
    device_id: deviceId
  }
}
