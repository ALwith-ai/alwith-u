import type { ImageSelection } from "@alwith/module-chat/image"

import { parseInputSnapshot, type SessionInputConfig, type SessionInputConfigSnapshot } from "@/agent/input-config"
import { type InputMode, inputModeDefinition, resolveInputMode } from "@/agent/input-modes"
import { imageInputMode } from "@/agent/input-modes/image"
import { openStore } from "@/lib/store"

export type { InputMode } from "@/agent/input-modes"
const cache = openStore("session-input-cache")
type PreferencesPort = {
  read: (sessionId: string) => Promise<SessionInputConfigSnapshot>
  write: (sessionId: string, inputConfig: SessionInputConfig) => Promise<SessionInputConfigSnapshot>
}
let port: PreferencesPort | null = null
const reads = new Map<string, Promise<SessionInputConfigSnapshot>>()
const generations = new Map<string, number>()

/** Main owns ACP; other windows forward these operations through its existing bridge. */
export function configureSessionInputConfig(value: PreferencesPort): void {
  port = value
}

function owner(): PreferencesPort {
  if (port === null) throw new Error("Session input configuration is not connected")
  return port
}

async function remember(
  value: SessionInputConfigSnapshot,
  generation = generations.get(value.sessionId) ?? 0
): Promise<SessionInputConfigSnapshot> {
  if (generation !== (generations.get(value.sessionId) ?? 0)) return value
  await cache.set(value.sessionId, value)
  return value
}

/** Every restore reads Codex; the local cache is never an authority or an offline fallback. */
function read(sessionId: string): Promise<SessionInputConfigSnapshot> {
  const pending = reads.get(sessionId)
  if (pending) return pending
  const generation = generations.get(sessionId) ?? 0
  const next = owner()
    .read(sessionId)
    .then((value) => remember(parseInputSnapshot(value, sessionId), generation))
    .finally(() => {
      if (reads.get(sessionId) === next) reads.delete(sessionId)
    })
  reads.set(sessionId, next)
  return next
}

export async function watchSessionInputMode(
  sessionId: string,
  listener: (mode: InputMode) => void,
  onError: (error: unknown) => void
): Promise<() => void> {
  let changed = false
  const stop = await cache.onKeyChange<unknown>(sessionId, (value) => {
    changed = true
    try {
      listener(value === undefined ? "chat" : resolveInputMode(parseInputSnapshot(value, sessionId).inputConfig))
    } catch (error) {
      onError(error)
    }
  })
  try {
    const mode = await readSessionInputMode(sessionId)
    if (!changed) listener(mode)
    return stop
  } catch (error) {
    stop()
    throw error
  }
}

export async function readSessionInputMode(sessionId: string): Promise<InputMode> {
  return resolveInputMode((await read(sessionId)).inputConfig)
}

export async function saveSessionInputMode(
  sessionId: string,
  mode: InputMode,
  config: SessionInputConfig["config"]
): Promise<void> {
  const definition = inputModeDefinition(mode)
  const validated = definition.parseConfig(config)
  if (!definition.persistConfig) return
  const generation = generations.get(sessionId) ?? 0
  await remember(parseInputSnapshot(await owner().write(sessionId, { mode, config: validated }), sessionId), generation)
}

export async function readSessionImageSelection(sessionId: string): Promise<ImageSelection | undefined> {
  const inputConfig = (await read(sessionId)).inputConfig
  const mode = resolveInputMode(inputConfig)
  return mode === "image" && inputConfig ? imageInputMode.parseConfig(inputConfig.config) : undefined
}

export async function saveSessionImageSelection(sessionId: string, selection: ImageSelection): Promise<void> {
  const generation = generations.get(sessionId) ?? 0
  const inputConfig = (await read(sessionId)).inputConfig ?? { mode: "chat", config: {} }
  if (generation !== (generations.get(sessionId) ?? 0))
    throw new Error("The session was deleted before saving its image selection")
  if (resolveInputMode(inputConfig) !== "image") throw new Error("Cannot save image configuration for a chat session")
  await remember(
    parseInputSnapshot(
      await owner().write(sessionId, { mode: "image", config: imageInputMode.parseConfig(selection) }),
      sessionId
    ),
    generation
  )
}

/** Codex deletes its associated attachments; only the disposable U cache needs local cleanup. */
export function deleteSessionInputMode(sessionId: string): Promise<void> {
  generations.set(sessionId, (generations.get(sessionId) ?? 0) + 1)
  reads.delete(sessionId)
  return cache.delete(sessionId)
}
