import { isText } from "@alwith/api"
import { buildGamepadPrompt, extractJson, sanitizeAiConfig } from "@alwith/module-gamepad/ai"
import type { GamepadHost } from "@alwith/module-gamepad/react"
import { invoke } from "@tauri-apps/api/core"
import { platform } from "@tauri-apps/plugin-os"

import { CodexClient } from "@/agent/client"
import { commands } from "@/bindings"
import { loadPreferences } from "@/lib/preferences"
import { loadProviders, resolveSessionModel } from "@/lib/providers"
import { runtimeClient } from "@/lib/runtime"

type GenerateConfig = NonNullable<GamepadHost["generateConfig"]>
export type GamepadAiContext = {
  client: CodexClient
  cwd: string
  model: string | null
  platform: GamepadHost["platform"]
  prepare?: () => Promise<void>
  dispose: () => Promise<void>
}

async function openContext(): Promise<GamepadAiContext> {
  const [preferences, providers, port] = await Promise.all([loadPreferences(), loadProviders(), runtimeClient()])
  const cwd = await commands.draftDirectory({ cwd: preferences.lastProjectDirectory })
  const agentId = `gamepad-config-${crypto.randomUUID()}`
  const client = new CodexClient(async () => port, { agentId, launch: { engine: "codex" } })
  const os = platform()
  if (os !== "macos" && os !== "windows" && os !== "linux") throw new Error(`Unsupported platform: ${os}`)
  const stop = await port.onRunStates(states => client.applyRunStates(states))
  return {
    client,
    cwd,
    platform: os,
    prepare: () => invoke("gamepad_ai_prepare", { agentId }),
    model: resolveSessionModel(preferences.modelSelections.main, providers),
    dispose: async () => {
      stop()
      client.disconnect()
      await port.stop(agentId)
    }
  }
}

/** A separate Codex-owned session keeps generation out of the selected chat. */
export function createGamepadConfigGenerator(open: () => Promise<GamepadAiContext>): GenerateConfig {
  return async (scene, config, signal, onProgress) => {
    signal.throwIfAborted()
    const context = await open()
    const { client } = context
    let sessionId: string | null = null
    let unsubscribe = (): void => {}
    let abort = (): void => {}
    let timer: ReturnType<typeof setTimeout> | undefined
    let failure: unknown
    let output: Awaited<ReturnType<GenerateConfig>> | undefined
    const cleanupErrors: unknown[] = []
    try {
      signal.throwIfAborted()
      await client.connect()
      signal.throwIfAborted()
      await context.prepare?.()
      signal.throwIfAborted()
      sessionId = await client.newSession(context.cwd, context.model)
      signal.throwIfAborted()
      const id = sessionId
      const result = new Promise<string>((resolve, reject) => {
        let previousText = ""
        let previousChars = 0
        const inspect = (): void => {
          try {
            const state = client.state
            if (state.connection !== "ready") throw new Error(state.connectionError ?? "Codex disconnected")
            const session = state.sessions[id]
            if (!session) throw new Error("Gamepad generation session closed")
            if (session.error) throw new Error(session.error.error?.message ?? session.error.stopReason)
            if (state.actions.some(action => action.sessionId === id))
              throw new Error("Gamepad generation requires interactive approval")
            let text = ""
            let chars = 0
            for (const item of session.items) {
              if (item.kind !== "assistant" && item.kind !== "thought") continue
              for (const block of item.content) {
                if (!isText(block)) continue
                chars += block.text.length
                if (item.kind === "assistant") text += block.text
              }
            }
            if (text !== previousText || chars !== previousChars) {
              previousText = text
              previousChars = chars
              onProgress?.(chars, text)
            }
            // The receipt only acknowledges acceptance. Wait for both Runtime completion
            // and the folded turn-end update, which can arrive in either order.
            if (state.runStates[id]?.state === "done" && session.lastStopReason !== null) resolve(text)
          } catch (error) {
            reject(error)
          }
        }
        abort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"))
        signal.addEventListener("abort", abort, { once: true })
        unsubscribe = client.store.subscribe(inspect)
        timer = setTimeout(() => reject(new Error("Gamepad configuration generation timed out")), 180_000)
        inspect()
      })
      // Observe failures immediately, including cancellation before prompt acceptance.
      const sending = client.prompt(id, [{ type: "text", text: buildGamepadPrompt(scene, config, context.platform) }])
      const [, text] = await Promise.all([sending, result])
      output = sanitizeAiConfig(extractJson(text))
    } catch (error) {
      failure = error
    } finally {
      unsubscribe()
      signal.removeEventListener("abort", abort)
      clearTimeout(timer)
      if (sessionId !== null) {
        try {
          await client.cancel(sessionId)
        } catch (error) {
          cleanupErrors.push(error)
        }
        try {
          await client.close(sessionId)
        } catch (error) {
          cleanupErrors.push(error)
        }
      }
      try {
        await context.dispose()
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    if (cleanupErrors.length)
      throw new AggregateError(
        failure === undefined ? cleanupErrors : [failure, ...cleanupErrors],
        "Gamepad generation cleanup failed"
      )
    if (failure !== undefined) throw failure
    if (output === undefined) throw new Error("Gamepad generation returned no configuration")
    return output
  }
}

export const generateGamepadConfig: GenerateConfig = createGamepadConfigGenerator(openContext)
