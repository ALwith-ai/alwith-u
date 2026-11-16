import { chromium } from "playwright-core"
export function createExecutor(
  connect?: typeof chromium.connectOverCDP,
  request?: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>
): {
  dispatch(message: Record<string, unknown>): Promise<unknown>
  close(): Promise<void>
}
