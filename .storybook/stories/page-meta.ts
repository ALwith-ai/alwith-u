import type { StoryContext } from "@storybook/react-vite"

import type preview from "../preview"

type MetaInput = Parameters<typeof preview.meta>[0]

/**
 * The meta annotations a source shares with the boards and workflows derived from it.
 * Each `preview.meta()` call keeps its own `id`, `title` and `component`, which Storybook reads statically:
 * docgen only finds a component written as an imported identifier in the meta call itself.
 */
export type SharedMeta<Props> = Omit<MetaInput, "id" | "title" | "component" | "args"> & {
  args?: Partial<Props>
}

/** A play function, or a step of one, that several stories of a source share. */
export type SharedPlay<Props> = (context: StoryContext<Props>) => Promise<void>
