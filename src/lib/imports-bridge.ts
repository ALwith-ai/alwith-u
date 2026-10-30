import type { CodexCapabilitiesClient } from "@nyssance/codex-acp-v2/client"
import type {
  ExternalAgentConfigImportTypeResult,
  ExternalAgentConfigMigrationItem,
  ImportSource
} from "@nyssance/codex-acp-v2/import"
import { emitTo, listen } from "@tauri-apps/api/event"
import { useEffect, useState } from "react"

import type { CodexClient } from "@/agent/client"
import { commands } from "@/bindings"
import { explainRequestError } from "@/core/request-error"

type History = Awaited<ReturnType<CodexCapabilitiesClient["importHistory"]>>["data"]
export type ImportState = {
  phase: "idle" | "detecting" | "selecting" | "importing" | "complete" | "error"
  source: ImportSource | null
  items: ExternalAgentConfigMigrationItem[]
  results: ExternalAgentConfigImportTypeResult[]
  history: History
  error: string | null
}
const EMPTY_IMPORT_STATE: ImportState = {
  phase: "idle",
  source: null,
  items: [],
  results: [],
  history: [],
  error: null
}
export type ImportAction =
  { action: "refresh" } | { action: "detect"; source: ImportSource } | { action: "import"; indices: number[] }
const REQUEST = "settings:import-request"
const STATE = "settings:import-state"

/** Owned by the main window; hiding settings never interrupts an import. */
export class ImportController {
  state: ImportState = EMPTY_IMPORT_STATE
  private generation = 0
  private readonly api: () => CodexCapabilitiesClient
  private readonly cwds: () => string[]
  private readonly publish: (state: ImportState) => void
  private readonly prepareCursor: (cwds: string[]) => Promise<void>
  constructor(
    api: () => CodexCapabilitiesClient,
    cwds: () => string[],
    publish: (state: ImportState) => void,
    prepareCursor: (cwds: string[]) => Promise<void> = async (cwds) => {
      await commands.prepareCursorImport({ cwds })
    }
  ) {
    this.api = api
    this.cwds = cwds
    this.publish = publish
    this.prepareCursor = prepareCursor
  }
  private set(change: Partial<ImportState>) {
    this.state = { ...this.state, ...change }
    this.publish(this.state)
  }
  async dispatch(action: ImportAction) {
    this.publish(this.state)
    if (this.state.phase === "detecting" || this.state.phase === "importing") return
    const generation = ++this.generation
    try {
      if (action.action === "refresh") {
        const history = (await this.api().importHistory()).data
        if (generation === this.generation)
          this.set({ history, error: null, phase: this.state.phase === "error" ? "idle" : this.state.phase })
      } else if (action.action === "detect") {
        this.set({ phase: "detecting", source: action.source, items: [], results: [], error: null })
        const cwds = this.cwds()
        if (action.source === "cursor") await this.prepareCursor(cwds)
        const detected = await this.api().detectImports({
          migrationSource: action.source,
          includeHome: true,
          cwds
        })
        this.set({ phase: "selecting", items: detected.items })
      } else {
        if (this.state.source === null || this.state.phase !== "selecting")
          throw new Error("Detect imports before choosing items")
        const indices = [...new Set(action.indices)]
        if (indices.length === 0) throw new Error("Select at least one item")
        const migrationItems = indices.map((index) => {
          if (!Number.isInteger(index) || index < 0 || index >= this.state.items.length)
            throw new Error("Invalid import selection")
          return this.state.items[index]
        })
        const migrationSource = this.state.source
        this.set({ phase: "importing", results: [], error: null })
        const completed = await this.api().runImport(
          { migrationItems, migrationSource, source: "alwith-u", providerId: migrationSource },
          (progress) => this.set({ results: progress.itemTypeResults })
        )
        this.set({ phase: "complete", results: completed.itemTypeResults })
        const history = (await this.api().importHistory()).data
        if (generation === this.generation) this.set({ history })
      }
    } catch (error) {
      if (generation !== this.generation) return
      const explained = explainRequestError(error, `import/${action.action}`)
      this.set({
        phase: this.state.phase === "complete" ? "complete" : "error",
        error: explained instanceof Error ? explained.message : String(explained)
      })
    }
  }
}

export function serveImportsBridge(client: CodexClient): () => void {
  const controller = new ImportController(
    () => client.codexCapabilities,
    () => [
      ...new Set(
        client.state.sessionList
          .map((session) => session.cwd)
          .filter((cwd): cwd is string => typeof cwd === "string" && cwd.length > 0)
      )
    ],
    (state) => {
      void emitTo("settings", STATE, state).catch((error: unknown) =>
        console.error("Import state delivery failed", error)
      )
    }
  )
  const stop = listen<ImportAction>(REQUEST, ({ payload }) => void controller.dispatch(payload))
  return () => {
    void stop.then((dispose) => dispose())
  }
}

export const requestImportAction = (action: ImportAction) => emitTo("main", REQUEST, action)

export function useImportState(): ImportState | null {
  const [state, setState] = useState<ImportState | null>(null)
  useEffect(() => {
    let disposed = false
    const timer = setTimeout(() => {
      if (!disposed) setState({ ...EMPTY_IMPORT_STATE, phase: "error", error: "Import service did not respond" })
    }, 15000)
    const stop = listen<ImportState>(STATE, ({ payload }) => {
      clearTimeout(timer)
      if (!disposed) setState(payload)
    })
    void stop
      .then(() => {
        if (!disposed) return requestImportAction({ action: "refresh" })
      })
      .catch((error: unknown) => {
        clearTimeout(timer)
        if (!disposed) setState({ ...EMPTY_IMPORT_STATE, phase: "error", error: String(error) })
      })
    return () => {
      disposed = true
      clearTimeout(timer)
      void stop.then((dispose) => dispose())
    }
  }, [])
  return state
}
