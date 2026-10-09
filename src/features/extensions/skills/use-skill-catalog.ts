import { useEffect, useMemo, useState } from "react"
import type { SkillErrorInfo, SkillMetadata, SkillsListResponse } from "@/agent/codex-extensions"

interface SkillsApi {
  listSkills(cwds?: string[], forceReload?: boolean): Promise<SkillsListResponse>
  onSkillsChanged(listener: () => void): () => void
}

export type SkillCatalog =
  | { status: "disconnected" | "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; skills: SkillMetadata[]; errors: SkillErrorInfo[] }

export function useSkillCatalog(
  api: SkillsApi,
  cwd: string | null,
  ready: boolean,
  revision: string
): { catalog: SkillCatalog; refresh(): void } {
  const [refreshId, setRefreshId] = useState(0)
  const request = useMemo(() => ({ api, cwd, ready, revision, refreshId }), [api, cwd, ready, revision, refreshId])
  const [result, setResult] = useState<{ request: typeof request; catalog: SkillCatalog } | null>(null)
  useEffect(() => {
    if (!ready) return
    let disposed = false
    let generation = 0
    const load = async (): Promise<void> => {
      const current = ++generation
      setResult({ request, catalog: { status: "loading" } })
      try {
        const response = await api.listSkills(cwd === null ? [] : [cwd], true)
        const entries = cwd === null ? response.data : response.data.filter(entry => entry.cwd === cwd)
        if (entries.length === 0) throw new Error("Codex returned no skill catalog for the requested project")
        if (!disposed && generation === current) {
          setResult({
            request,
            catalog: {
              status: "loaded",
              skills: entries.flatMap(entry => entry.skills),
              errors: entries.flatMap(entry => entry.errors)
            }
          })
        }
      } catch (error) {
        if (!disposed && generation === current)
          setResult({
            request,
            catalog: { status: "error", message: error instanceof Error ? error.message : String(error) }
          })
      }
    }
    const stop = api.onSkillsChanged(() => {
      void load()
    })
    void load()
    return () => {
      disposed = true
      stop()
    }
  }, [api, cwd, ready, request])
  return {
    catalog: !ready ? { status: "disconnected" } : result?.request === request ? result.catalog : { status: "loading" },
    refresh: () => setRefreshId(value => value + 1)
  }
}
