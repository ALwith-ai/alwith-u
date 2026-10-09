import { afterEach, expect, test } from "vitest"
import { act, cleanup, renderHook } from "@testing-library/react"
import type { SkillsListResponse } from "@/agent/codex-extensions"
import { useSkillCatalog } from "../skills/use-skill-catalog"

afterEach(cleanup)

function response(cwd: string): SkillsListResponse {
  return { data: [{ cwd, skills: [], errors: [] }] }
}

test("catalog reloads on changes and ignores old projects and superseded responses", async () => {
  const pending: { cwd: string; resolve(value: SkillsListResponse): void }[] = []
  let changed = (): void => {}
  const api = {
    listSkills(cwds?: string[]): Promise<SkillsListResponse> {
      return new Promise(resolve => pending.push({ cwd: cwds?.[0] ?? "", resolve }))
    },
    onSkillsChanged(callback: () => void): () => void {
      changed = callback
      return () => {
        changed = () => {}
      }
    }
  }
  const view = renderHook(({ cwd }) => useSkillCatalog(api, cwd, true, "revision"), { initialProps: { cwd: "/a" } })
  expect(view.result.current.catalog.status).toBe("loading")
  view.rerender({ cwd: "/b" })
  expect(pending.map(item => item.cwd)).toEqual(["/a", "/b"])
  await act(async () => pending[0].resolve(response("/a")))
  expect(view.result.current.catalog.status).toBe("loading")
  await act(async () => pending[1].resolve(response("/b")))
  expect(view.result.current.catalog).toEqual({ status: "loaded", skills: [], errors: [] })
  await act(async () => {
    changed()
    changed()
  })
  await act(async () => pending[3].resolve(response("/b")))
  await act(async () => pending[2].resolve({ data: [] }))
  expect(view.result.current.catalog.status).toBe("loaded")
  view.unmount()
  changed()
  expect(pending).toHaveLength(4)
})

test("connection and catalog errors never report missing skills and retry can recover", async () => {
  let fail = true
  const api = {
    async listSkills(): Promise<SkillsListResponse> {
      if (fail) throw new Error("Catalog unavailable")
      return { data: [{ cwd: "/a", skills: [], errors: [{ path: "/broken/SKILL.md", message: "Invalid skill" }] }] }
    },
    onSkillsChanged(): () => void {
      return () => {}
    }
  }
  const view = renderHook(({ ready }) => useSkillCatalog(api, "/a", ready, "revision"), {
    initialProps: { ready: false }
  })
  expect(view.result.current.catalog.status).toBe("disconnected")
  await act(async () => view.rerender({ ready: true }))
  expect(view.result.current.catalog).toEqual({ status: "error", message: "Catalog unavailable" })
  fail = false
  await act(async () => view.result.current.refresh())
  expect(view.result.current.catalog).toEqual({
    status: "loaded",
    skills: [],
    errors: [{ path: "/broken/SKILL.md", message: "Invalid skill" }]
  })
})

test("extension changes recheck the catalog and disconnect hides the previous result", async () => {
  let enabled = true
  const api = {
    async listSkills(): Promise<SkillsListResponse> {
      return {
        data: [
          {
            cwd: "/a",
            errors: [],
            skills: [
              {
                name: "yup-kb",
                enabled,
                path: "/skills/yup-kb/SKILL.md",
                description: "",
                scope: "user",
                pluginId: null
              }
            ]
          }
        ]
      }
    },
    onSkillsChanged(): () => void {
      return () => {}
    }
  }
  const view = renderHook(({ revision, ready }) => useSkillCatalog(api, "/a", ready, revision), {
    initialProps: { revision: "initial", ready: true }
  })
  await act(async () => {})
  expect(view.result.current.catalog).toMatchObject({ status: "loaded", skills: [{ enabled: true }] })
  enabled = false
  await act(async () => view.rerender({ revision: "updated", ready: true }))
  expect(view.result.current.catalog).toMatchObject({ status: "loaded", skills: [{ enabled: false }] })
  view.rerender({ revision: "updated", ready: false })
  expect(view.result.current.catalog.status).toBe("disconnected")
})
