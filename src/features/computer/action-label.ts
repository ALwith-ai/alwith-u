const actionKeys: Record<string, string> = {
  launch_app: "open",
  list_apps: "observe",
  list_windows: "observe",
  get_app_state: "observe",
  get_window_state: "observe",
  get_desktop_state: "observe",
  screenshot: "observe",
  click: "click",
  double_click: "click",
  move_cursor: "move",
  drag: "drag",
  scroll: "scroll",
  type_text: "type",
  press_key: "key",
  hotkey: "key",
  run_steps: "steps"
}
export function computerActionKey(action: string | null): string {
  return `computer.actions.${actionKeys[action ?? ""] ?? "working"}`
}
export function privateComputerAction(name: string): string | null {
  const match = /^(?:mcp__)?alwith_computer(?:__|\.)([a-z_]+)$/.exec(name)
  return match?.[1] ?? null
}
