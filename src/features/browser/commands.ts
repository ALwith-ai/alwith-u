/** Browser-level commands. The native guest claims the same chords before page content. */
const paneCommands = [
  "focus-address",
  "reload",
  "hard-reload",
  "back",
  "forward",
  "stop",
  "find",
  "find-next",
  "find-previous",
  "bookmark",
  "print",
  "view-source"
] as const
export type PaneCommand = (typeof paneCommands)[number]
export type BrowserCommand =
  | PaneCommand
  | "new-tab"
  | "reopen-tab"
  | "new-private-tab"
  | "close-tab"
  | "search-tabs"
  | "previous-tab"
  | "next-tab"
  | "tab-last"
  | "zoom-in"
  | "zoom-out"
  | "zoom-reset"
  | `tab-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`

const plain: Record<string, BrowserCommand> = {
  KeyL: "focus-address",
  KeyR: "reload",
  KeyT: "new-tab",
  KeyW: "close-tab",
  BracketLeft: "back",
  BracketRight: "forward",
  Period: "stop",
  KeyF: "find",
  KeyD: "bookmark",
  KeyP: "print",
  KeyG: "find-next",
  Equal: "zoom-in",
  Minus: "zoom-out",
  Digit0: "zoom-reset",
  NumpadAdd: "zoom-in",
  NumpadSubtract: "zoom-out",
  Numpad0: "zoom-reset",
  Digit1: "tab-1",
  Digit2: "tab-2",
  Digit3: "tab-3",
  Digit4: "tab-4",
  Digit5: "tab-5",
  Digit6: "tab-6",
  Digit7: "tab-7",
  Digit8: "tab-8",
  Digit9: "tab-last"
}
const shifted: Record<string, BrowserCommand> = {
  KeyR: "hard-reload",
  KeyG: "find-previous",
  KeyT: "reopen-tab",
  KeyN: "new-private-tab",
  KeyA: "search-tabs",
  BracketLeft: "previous-tab",
  BracketRight: "next-tab",
  Equal: "zoom-in"
}

/** The command of a key press in the application document; mirrors the native guest filter. */
export function keyCommand(event: {
  code: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  isComposing?: boolean
}): BrowserCommand | undefined {
  if (!event.metaKey || event.ctrlKey || event.isComposing) return undefined
  // Cmd+Option+U, as Chrome has it; no other chord takes Option.
  if (event.altKey) return event.code === "KeyU" && !event.shiftKey ? "view-source" : undefined
  return (event.shiftKey ? shifted : plain)[event.code]
}

export const isPaneCommand = (command: string): command is PaneCommand =>
  (paneCommands as readonly string[]).includes(command)
