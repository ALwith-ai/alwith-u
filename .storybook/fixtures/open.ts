import { fn } from "storybook/test"

export { fileLocationPath } from "../../src/lib/open"

// Every export of `src/lib/open.ts` that reaches the system, as a resolved mock.
export const openExternal = fn<(url: string) => Promise<void>>().mockResolvedValue(undefined)
export const openExternalEntry = fn<(path: string) => Promise<void>>().mockResolvedValue(undefined)
export const openHtmlInBrowser = fn<(path: string) => Promise<void>>().mockResolvedValue(undefined)
export const openLocalPath = fn<(path: string) => Promise<void>>().mockResolvedValue(undefined)
export const revealInFileManager = fn<(path: string) => Promise<void>>().mockResolvedValue(undefined)
