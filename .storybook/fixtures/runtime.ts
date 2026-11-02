export const CODEX_AGENT_ID = "storybook"
export function runtimeClient(): Promise<never> {
  return Promise.reject(new Error("Native Runtime is disabled in Storybook"))
}
export function onHubExit(): Promise<() => void> {
  return Promise.resolve(() => {})
}
