import { deviceSessionContext as packageDeviceSessionContext } from "@alwith/module-device/tauri"

/** The device server for one new agent session, or nothing when the platform has no simulators. */
export async function deviceSessionContext(): ReturnType<typeof packageDeviceSessionContext> {
  try {
    return await packageDeviceSessionContext()
  } catch {
    // A device host that cannot describe itself must not keep the conversation from starting.
    return { mcpServers: [] }
  }
}
