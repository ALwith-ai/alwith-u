import { isMac } from "./platform"

/**
 * Keyboard shortcut in Tauri accelerator format → display symbols. `|` separates alternates;
 * the variant with the most key segments is shown ("Fn|CommandOrControl+D" → ⌘D, not fn).
 * On macOS modifiers become symbols (⌘ ⇧ ⌥ ⌃); elsewhere they become words (Ctrl, Shift, Alt).
 */
export function formatShortcutForDisplay(key: string): string[] {
  const mac = isMac()
  const variants = key
    .split("|")
    .map(s => s.trim())
    .filter(Boolean)
  const chosen = variants.reduce(
    (best, cur) => (cur.split("+").length > best.split("+").length ? cur : best),
    variants[0] ?? key
  )
  const symbols: string[] = []
  for (const part of chosen.split("+").map(p => p.trim())) {
    switch (part.toLowerCase()) {
      case "commandorcontrol":
      case "cmdorctrl":
        symbols.push(mac ? "⌘" : "Ctrl")
        break
      case "command":
      case "meta":
      case "cmd":
        symbols.push(mac ? "⌘" : "Win")
        break
      case "control":
      case "ctrl":
        symbols.push(mac ? "⌃" : "Ctrl")
        break
      case "shift":
        symbols.push(mac ? "⇧" : "Shift")
        break
      case "alt":
      case "option":
        symbols.push(mac ? "⌥" : "Alt")
        break
      case "enter":
      case "return":
        symbols.push(mac ? "↩" : "Enter")
        break
      case "tab":
        symbols.push(mac ? "⇥" : "Tab")
        break
      case "backspace":
      case "delete":
        symbols.push(mac ? "⌫" : "Backspace")
        break
      case "escape":
      case "esc":
        symbols.push(mac ? "⎋" : "Esc")
        break
      case "space":
        symbols.push(mac ? "␣" : "Space")
        break
      case "fn":
        symbols.push("fn")
        break
      case "arrowleft":
        symbols.push("←")
        break
      case "arrowright":
        symbols.push("→")
        break
      case "arrowup":
        symbols.push("↑")
        break
      case "arrowdown":
        symbols.push("↓")
        break
      default:
        symbols.push(part.toUpperCase())
    }
  }
  return symbols
}

/** One display string: symbols run together on macOS ("⌘N"), joined with `+` elsewhere ("Ctrl+N"). */
export function displayShortcut(key: string): string {
  return formatShortcutForDisplay(key).join(isMac() ? "" : "+")
}
