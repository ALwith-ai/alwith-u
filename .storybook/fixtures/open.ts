import { fn } from "storybook/test"

export const openExternal = fn<(url: string) => Promise<void>>().mockResolvedValue(undefined)
