import { IMAGE_MODELS, type ImageSelection } from "@alwith/module-chat/image"

import { openStore } from "@/lib/store"

export type InputMode = "chat" | "image"
const store = openStore("chat-input-modes")
type InputPreferences = { mode: InputMode; selection?: ImageSelection }

function parse(value: unknown): InputPreferences {
  if (value === undefined) return { mode: "chat" }
  if (value === "chat" || value === "image") return { mode: value }
  if (typeof value !== "object" || value === null || !("mode" in value))
    throw new Error("Invalid saved conversation input preferences")
  if (value.mode !== "chat" && value.mode !== "image") throw new Error("Invalid saved conversation input mode")
  if (!("selection" in value) || value.selection === undefined) return { mode: value.mode }
  const selection = value.selection
  if (
    typeof selection !== "object" ||
    selection === null ||
    !("model" in selection) ||
    !("size" in selection) ||
    typeof selection.model !== "string" ||
    typeof selection.size !== "string"
  )
    throw new Error("Invalid saved conversation image selection")
  const model = IMAGE_MODELS.find((model) => model.id === selection.model)
  if (!model) throw new Error("Invalid saved conversation image model")
  if (!(model.sizes as readonly string[]).includes(selection.size))
    throw new Error("Invalid saved conversation image resolution")
  return { mode: value.mode, selection: { model: model.id, size: selection.size } }
}

async function read(sessionId: string): Promise<InputPreferences> {
  return parse(await store.get<unknown>(sessionId))
}

/** Subscribe before reading so newer native changes win over a pending initial read. */
export async function watchSessionInputMode(
  sessionId: string,
  listener: (mode: InputMode) => void,
  onError: (error: unknown) => void
): Promise<() => void> {
  let changed = false
  const stop = await store.onKeyChange<unknown>(sessionId, (value) => {
    changed = true
    try {
      listener(parse(value).mode)
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

/** Input presentation is an application preference; Codex owns the conversation. */
export async function readSessionInputMode(sessionId: string): Promise<InputMode> {
  return (await read(sessionId)).mode
}

export function saveSessionInputMode(sessionId: string, mode: InputMode, selection: ImageSelection): Promise<void> {
  return store.set(sessionId, { mode, selection })
}

export async function readSessionImageSelection(sessionId: string): Promise<ImageSelection | undefined> {
  return (await read(sessionId)).selection
}

export async function saveSessionImageSelection(sessionId: string, selection: ImageSelection): Promise<void> {
  const preferences = await read(sessionId)
  await store.set(sessionId, { ...preferences, selection })
}

export async function copySessionInputPreferences(sourceId: string, targetId: string): Promise<void> {
  await store.set(targetId, await read(sourceId))
}

export function deleteSessionInputMode(sessionId: string): Promise<void> {
  return store.delete(sessionId)
}
