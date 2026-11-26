import type { Browser } from "playwright-core"

export interface BrowserTools {
  // Website evaluations and CDP replies have caller-defined result shapes.
  (name: string, args?: Record<string, unknown>): Promise<any>
  release(target: string): Promise<{ disconnected: boolean }>
  close(): Promise<void>
}
export function createBrowserTools(
  call: (request: { target?: string; method: string; params?: Record<string, unknown> }) => Promise<unknown>,
  attach?: (target: string) => Promise<Browser>,
  options?: {
    nativeDownloads?: boolean
    /** The application shows a page's dialogs itself and answers them through the native route. */
    nativeDialogs?: boolean
    /** Runs a script against the tab once this process has let go of it. */
    runScript?: (target: string, args: Record<string, unknown>) => Promise<unknown>
  }
): BrowserTools
