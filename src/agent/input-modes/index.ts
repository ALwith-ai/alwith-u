import type { SessionInputConfig } from "../input-config"
import { chatInputMode } from "./chat"
import { imageInputMode } from "./image"

const inputModeDefinitions = { chat: chatInputMode, image: imageInputMode }
export type InputMode = keyof typeof inputModeDefinitions

export function isInputMode(mode: string): mode is InputMode {
  return Object.hasOwn(inputModeDefinitions, mode)
}

export function inputModeDefinition(mode: string) {
  if (!isInputMode(mode)) throw new Error(`Unsupported input mode: ${mode}`)
  return inputModeDefinitions[mode]
}

export function resolveInputMode(inputConfig: SessionInputConfig | null): InputMode {
  // Absence means default chat; transport and validation failures must still propagate.
  if (inputConfig === null) return "chat"
  const mode = inputConfig.mode
  if (!isInputMode(mode)) throw new Error(`Unsupported input mode: ${mode}`)
  inputModeDefinitions[mode].parseConfig(inputConfig.config)
  return mode
}
