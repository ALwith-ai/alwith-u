import type { Browser } from "playwright-core"

export interface BrowserTools {
  // Website evaluations and CDP replies have caller-defined result shapes.
  (name: string, args?: Record<string, unknown>): Promise<any>
  close(): Promise<void>
}
export function createBrowserTools(
  call: (request: { target?: string; method: string; params?: Record<string, unknown> }) => Promise<unknown>,
  attach?: (target: string) => Promise<Browser>,
  options?: { nativeDownloads?: boolean }
): BrowserTools
