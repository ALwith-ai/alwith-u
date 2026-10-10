import { fn } from "storybook/test"

export { fileLocationPath } from "../../src/lib/open"

export const openExternal = fn<(url: string) => Promise<void>>().mockResolvedValue(undefined)
