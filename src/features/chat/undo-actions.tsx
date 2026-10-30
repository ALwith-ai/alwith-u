import { createStore } from "@alwith/api/client"
import type { ToolItem } from "@nyssance/codex-acp-v2/client"
import { invoke } from "@tauri-apps/api/core"
import { Redo2Icon, Undo2Icon } from "lucide-react"
import { useMemo, useSyncExternalStore } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { client } from "@/lib/client"

import { filePatches, type PatchResult, updateUndone } from "./undo"

interface ActionState {
  pending: boolean
  undone: boolean[]
  error: string | null
}
// Transient action state survives virtualized card remounts; it is never conversation history.
const actions = createStore<{ entries: Record<string, ActionState> }>({
  entries: {}
})
const initial: ActionState = { pending: false, undone: [], error: null }

export function UndoActions({ sessionId, items }: { sessionId: string; items: ToolItem[] }) {
  const { t } = useTranslation()
  const batch = useMemo(() => {
    try {
      return { patches: filePatches(items), error: null }
    } catch {
      return { patches: [], error: t("undo.unsupported") }
    }
  }, [items, t])
  const key = JSON.stringify([sessionId, items.map((item) => item.id), batch.patches])
  const state = useSyncExternalStore(
    (listener) => actions.subscribe(listener),
    () => actions.getState().entries[key] ?? initial
  )
  const session = useSyncExternalStore(
    (listener) => client.store.subscribe(listener),
    () => client.state.sessions[sessionId]
  )
  const blocked = !session || session.state !== "idle" || session.restoring || session.readOnly
  const set = (value: ActionState) =>
    actions.setState({
      entries: { ...actions.getState().entries, [key]: value }
    })
  const run = async (reverse: boolean) => {
    if (actions.getState().entries[key]?.pending || blocked || batch.error) return
    const current = actions.getState().entries[key] ?? initial
    const selected = batch.patches
      .map((_, index) => index)
      .filter((index) => Boolean(current.undone[index]) !== reverse)
    if (!selected.length) return
    set({ ...current, pending: true, error: null })
    try {
      const live = client.state.sessions[sessionId]
      if (!live || live.state !== "idle" || live.restoring || live.readOnly) throw new Error(t("undo.busy"))
      const result = await invoke<PatchResult>("workspace_apply_patches", {
        root: live.cwd,
        patches: selected.map((index) => batch.patches[index]),
        reverse
      })
      set({
        pending: false,
        undone: updateUndone(current.undone, selected, result, reverse),
        error: result.failed
          ? t("undo.failed", {
              count: result.applied.length,
              detail: result.failed.message
            })
          : (result.warning ?? null)
      })
    } catch (error) {
      set({
        ...current,
        pending: false,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }
  const hasUndone = state.undone.some(Boolean)
  const hasApplied = batch.patches.some((_, index) => !state.undone[index])
  const description = batch.error ?? state.error ?? (blocked ? t("undo.busy") : undefined)
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1" data-undo-actions>
      {hasApplied || batch.error ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={state.pending || blocked || !!batch.error}
          title={description}
          onClick={() => void run(true)}
        >
          <Undo2Icon className="size-3.5" />
          {t(state.pending ? "undo.working" : "undo.undo")}
        </Button>
      ) : null}
      {hasUndone ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={state.pending || blocked}
          title={description}
          onClick={() => void run(false)}
        >
          <Redo2Icon className="size-3.5" />
          {t("undo.reapply")}
        </Button>
      ) : null}
      {state.error ? (
        <span role="status" className="max-w-64 text-xs break-words whitespace-pre-wrap text-muted-foreground">
          {state.error}
        </span>
      ) : null}
    </div>
  )
}
