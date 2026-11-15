import { createStore } from "zustand/vanilla"

const key = "alwith.browser.extensions.hidden.v1"

function decode(raw: string): string[] {
  const value: unknown = JSON.parse(raw)
  if (!Array.isArray(value) || !value.every((entry: unknown) => typeof entry === "string"))
    throw new Error("Invalid hidden extensions")
  return value as string[]
}

export function loadHiddenExtensions(storage: Pick<Storage, "getItem"> = localStorage): string[] {
  const raw = storage.getItem(key)
  return raw === null ? [] : decode(raw)
}

/** An extension's button is in the toolbar unless the user took it out. */
export function withShown(hidden: readonly string[], id: string, shown: boolean): string[] {
  const others = hidden.filter((entry) => entry !== id)
  return shown ? others : [...others, id]
}

/** The extensions whose buttons the user took out of the toolbar, by id. */
export const hiddenExtensions = createStore<string[]>(() => loadHiddenExtensions())
hiddenExtensions.subscribe((hidden) => localStorage.setItem(key, JSON.stringify(hidden)))

export const setExtensionShown = (id: string, shown: boolean) =>
  hiddenExtensions.setState((hidden) => withShown(hidden, id, shown), true)
