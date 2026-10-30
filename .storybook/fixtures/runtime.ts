export const CODEX_AGENT_ID = "storybook"
export async function runtimeClient(): Promise<never> {
  throw new Error("Native Runtime is disabled in Storybook")
}
export async function onHubExit(): Promise<() => void> {
  return () => {}
}
