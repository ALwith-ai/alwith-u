import type { Browser, ConnectOverCDPOptions } from "playwright-core"
export function createExecutor(
  connect?: (url: string, options: ConnectOverCDPOptions) => Promise<Browser>,
  request?: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>
): {
  dispatch(message: Record<string, unknown>): Promise<unknown>
  close(): Promise<void>
}
