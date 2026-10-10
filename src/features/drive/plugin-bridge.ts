import type { Dispose, ExtensionData, Json } from "@alwith/module-extension"
import type { DriveRequest, DriveResponse } from "@alwith/module-drive"

interface PluginDataBinding {
  data: ExtensionData
  schemaVersion: number
}
let binding: PluginDataBinding | null = null
let archiveOwned: boolean | null = null
const listeners = new Set<() => void>()

export function bindDrivePluginData(data: ExtensionData, schemaVersion: number): Dispose {
  const current = { data, schemaVersion }
  binding = current
  const stop = data.subscribe(() => {
    for (const listener of listeners) listener()
  })
  for (const listener of listeners) listener()
  return async () => {
    await stop()
    if (binding === current) {
      binding = null
      for (const listener of listeners) listener()
    }
  }
}
export function subscribeDrivePluginData(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export function getDrivePluginData(): PluginDataBinding | null {
  return binding
}
export function setDriveArchiveOwner(enabled: boolean | null): void {
  archiveOwned = enabled
}
export function assertPluginSessionArchiveAllowed(): void {
  if (archiveOwned === null) throw new Error("Drive archive preference is still loading")
  if (archiveOwned) throw new Error("Session archival is managed by Drive; plugin synchronization is disabled")
}

function object(value: Json | null): Record<string, Json> {
  if (value === null) return {}
  if (typeof value !== "object" || Array.isArray(value))
    throw new Error("Knowledge plugin configuration must be an object")
  return value
}
class Superseded extends Error {}
export interface PluginBridgeHost {
  request(request: DriveRequest): Promise<DriveResponse>
  binding(): PluginDataBinding | null
  generation(): number | undefined
  setArchiveOwner(enabled: boolean): void
  declineSessionSync(check: () => void): Promise<void>
}

/** Patch the existing extension CAS store; never open another storage service or cache credentials. */
export async function syncDrivePlugin(host: PluginBridgeHost, disposed: () => boolean): Promise<void> {
  try {
    const snapshot = await host.request({ type: "snapshot" })
    if (snapshot.type !== "snapshot") throw new Error("Invalid Drive snapshot")
    const generation = snapshot.data.generation
    const selected = host.binding()
    const check = (): void => {
      if (disposed() || host.generation() !== generation || host.binding() !== selected) throw new Superseded()
    }
    const preferences = await host.request({ type: "preferences" })
    check()
    if (preferences.type !== "preferences") throw new Error("Invalid Drive preferences")
    const ownsArchive = snapshot.data.configured && preferences.data.sessionArchive
    host.setArchiveOwner(ownsArchive)
    if (!selected) return
    let token = ""
    if (snapshot.data.configured) {
      const config = await host.request({ type: "mcpSessionConfig" })
      check()
      if (config.type !== "mcpSessionConfig" || !config.data) throw new Error("Drive credentials are unavailable")
      const authorization = config.data.headers.find(header => header.name.toLowerCase() === "authorization")?.value
      if (!authorization?.startsWith("Bearer ")) throw new Error("Invalid Drive authorization header")
      token = authorization.slice("Bearer ".length)
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await selected.data.read()
      check()
      const data = object(current?.value ?? null)
      if (!snapshot.data.configured && data._alwithUDrive !== true) return
      const next: Record<string, Json> = { ...data, token }
      if (snapshot.data.configured) {
        next.baseUrl = snapshot.data.baseUrl
        next._alwithUDrive = true
      } else delete next._alwithUDrive
      if (ownsArchive) next._sessionsSync = { ...object(data._sessionsSync ?? null), consented: "declined" }
      if (JSON.stringify(next) !== JSON.stringify(data)) {
        const latest = await host.request({ type: "snapshot" })
        check()
        if (latest.type !== "snapshot" || latest.data.generation !== generation) throw new Superseded()
        try {
          await selected.data.write(next, current?.revision ?? null, selected.schemaVersion)
        } catch (error) {
          check()
          if (
            attempt < 2 &&
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "conflict"
          )
            continue
          throw error
        }
      }
      check()
      if (ownsArchive) await host.declineSessionSync(check)
      return
    }
  } catch (error) {
    if (!(error instanceof Superseded)) throw error
  }
}
