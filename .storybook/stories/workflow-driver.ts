import type { StoryObj } from "@storybook/react-vite"
import type { LoaderFunction } from "storybook/internal/types"
import { expect, waitFor, within } from "storybook/test"

import {
  disposePlaybackClock,
  installPlaybackClock,
  pausePlaybackClock,
  playbackDelay
} from "../fixtures/playback-clock"
import { preparePreview } from "../fixtures/prepare"
import type { ProductPreview } from "./product-preview"

export type WorkflowStory = StoryObj<typeof ProductPreview>
export interface WorkflowConfig {
  labels: string[]
  target: number | null
  id: string
}
interface CheckpointState {
  index: number
  finished: boolean
  error: string | null
}
let state: CheckpointState = { index: 0, finished: false, error: null }
const listeners = new Set<() => void>()
let generation = 0
let beforeAction: (() => Promise<void>) | null = null
let checkpoint: (() => Promise<void>) | null = null
const stop = Symbol("workflow checkpoint")
function update(next: Partial<CheckpointState>) {
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}
export const playback = {
  snapshot: () => state,
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }
}
export function workflowTarget(config: WorkflowConfig): number | null {
  const value = new URLSearchParams(window.location.search).get("workflowStep")
  if (value === null) return import.meta.env.STORYBOOK_TEST ? 0 : config.target
  const target = Number(value)
  if (!/^\d+$/.test(value) || target < 0 || target >= config.labels.length)
    throw new Error(`Invalid workflow checkpoint: ${value}`)
  return target
}
export const prepareWorkflow: LoaderFunction = async (context) => {
  generation++
  checkpoint = null
  beforeAction = null
  disposePlaybackClock()
  update({ index: 0, finished: false, error: null })
  await preparePreview(context)
  if (!import.meta.env.STORYBOOK_TEST && workflowTarget(context.parameters.workflow) !== null) installPlaybackClock()
  return {}
}
export async function workflowAction(_label: string, action: () => unknown) {
  await beforeAction?.()
  await action()
  await checkpoint?.()
}
export function workflowStory(source: WorkflowStory, config: WorkflowConfig): WorkflowStory {
  return {
    ...source,
    name: "完整流程图",
    parameters: { ...source.parameters, workflow: config },
    play: async (context) => {
      const target = workflowTarget(config)
      if (target === null) {
        // Each embedded page owns its source components, stores, portals and timers.
        await waitFor(
          () => {
            const pages = context.canvasElement.querySelectorAll("[data-workflow-step]")
            expect(pages).toHaveLength(config.labels.length)
            for (const page of pages) {
              expect(page.getAttribute("data-error")).toBeNull()
              expect(page.getAttribute("data-ready")).toBe("true")
            }
          },
          { timeout: 25_000 }
        )
        return
      }
      if (import.meta.env.STORYBOOK_TEST) {
        // Exercise each journey once with its complete assertions. Diagram layout and
        // iframe checkpoint isolation are covered by verify-player.mjs against the build.
        const page = context.canvasElement.querySelector<HTMLElement>("#workflow-page")!
        await source.play?.({ ...context, canvasElement: page, canvas: within(page) as typeof context.canvas })
        return
      }
      const currentGeneration = generation
      let index = 0
      const gate = async () => {
        if (currentGeneration !== generation || context.abortSignal?.aborted) throw stop
        // Let React and native editor changes paint before freezing this checkpoint.
        await playbackDelay(80)
        update({ index })
        if (index === target) {
          pausePlaybackClock(true)
          update({ finished: true })
          throw stop
        }
        index++
      }
      let started = false
      const begin = async () => {
        if (started) return
        started = true
        await gate()
      }
      beforeAction = begin
      checkpoint = gate
      const userEvent = new Proxy(context.userEvent, {
        get(target, property, receiver) {
          const value = Reflect.get(target, property, receiver)
          if (typeof value !== "function") return value
          return async (...args: unknown[]) => {
            await begin()
            const result = await Reflect.apply(value, target, args)
            if (property === "type" && args[0] instanceof HTMLElement && args[0].closest("[data-chat-search]")) {
              await waitFor(() => expect(CSS.highlights.get("chat-search-current")?.size ?? 0).toBeGreaterThan(0))
            }
            await gate()
            return result
          }
        }
      })
      try {
        const page = context.canvasElement.querySelector<HTMLElement>("#workflow-page")!
        if (source.play)
          await source.play({
            ...context,
            canvasElement: page,
            canvas: within(page) as typeof context.canvas,
            userEvent
          })
        await begin()
        if (config.labels.length > 1) await gate()
        throw new Error(`Missing workflow page ${target + 1}`)
      } catch (error) {
        if (error !== stop) {
          update({ error: error instanceof Error ? error.message : String(error) })
          throw error
        }
      } finally {
        if (currentGeneration === generation) {
          checkpoint = null
          beforeAction = null
        }
      }
    }
  }
}
