export interface BrowserRequest {
  target?: string
  method: string
  params?: Record<string, unknown>
}
export const tools: { name: string; description: string; inputSchema: object }[]
export function createBrowserTools(
  call: (request: BrowserRequest) => Promise<any>,
  attach?: (target: string) => Promise<import("playwright-core").Browser>
): ((name: string, args?: Record<string, any>) => Promise<any>) & { close(): Promise<void> }
export function handleMessage(
  message: { id?: string | number; method: string; params?: any },
  run: (name: string, args?: any) => Promise<any>
): Promise<any>
