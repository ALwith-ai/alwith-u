import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const bundle = readFileSync(
  new URL("../../../node_modules/@nyssance/codex-acp-v2/dist/index.js", import.meta.url),
  "utf8"
)
const start = bundle.indexOf("async function readForkLineage(")
const end = bundle.indexOf("async function forkSession(", start)
if (start < 0 || end < 0) throw new Error("Adapter fork lineage implementation is missing")

type Request = {
  threadId: string
  cursor: string | null
  limit: number
  sortDirection: "asc" | "desc"
  itemsView: "summary"
}
type Page = { data: { id: string }[]; nextCursor: string | null }
type Thread = { id: string; sessionId: string; forkedFromId: string | null }
const readLineage = new Function(`${bundle.slice(start, end)}; return readForkLineage`)() as (
  client: { threadTurnsList(request: Request): Promise<Page> },
  thread: Thread
) => Promise<{ nativeSessionId: string; forkedFromId: string | null; forkedAtTurnId?: string | null }>

function history(threads: Record<string, string[]>) {
  const requests: Request[] = []
  return {
    requests,
    async threadTurnsList(request: Request): Promise<Page> {
      requests.push(request)
      expect(request.itemsView).toBe("summary")
      const turns = [...threads[request.threadId]!]
      if (request.sortDirection === "desc") turns.reverse()
      const offset = Number(request.cursor ?? 0)
      return {
        data: turns.slice(offset, offset + 2).map((id) => ({ id })),
        nextCursor: offset + 2 < turns.length ? String(offset + 2) : null
      }
    }
  }
}

const fork: Thread = { id: "child", sessionId: "native-child", forkedFromId: "parent" }

test("restores the persisted boundary across pages after the parent and child diverge", async () => {
  const persisted = {
    parent: ["t1", "t2", "t3", "parent-later"],
    child: ["t1", "t2", "child-1", "child-2", "child-3"]
  }
  const client = history(persisted)
  expect(await readLineage(client, fork)).toEqual({
    nativeSessionId: "native-child",
    forkedFromId: "parent",
    forkedAtTurnId: "t2"
  })
  // A fresh client has no in-memory fork request or replay state.
  expect(await readLineage(history(persisted), fork)).toEqual(await readLineage(client, fork))
  expect(client.requests.some((request) => request.threadId === "child" && request.cursor !== null)).toBe(true)
})

test("nested forks use their immediate parent and preserve the selected older boundary", async () => {
  const client = history({ parent: ["root-1", "root-2", "parent-1"], child: ["root-1", "own-1"] })
  expect((await readLineage(client, fork)).forkedAtTurnId).toBe("root-1")
})

test("root sessions do not read history and empty forks expose a null boundary", async () => {
  const client = history({ parent: ["p"], child: [] })
  expect(await readLineage(client, { ...fork, forkedFromId: null })).toEqual({
    nativeSessionId: "native-child",
    forkedFromId: null
  })
  expect(client.requests).toHaveLength(0)
  expect((await readLineage(client, fork)).forkedAtTurnId).toBeNull()
})

test.each(["parent", "child"])("repeated %s cursors fail instead of hanging", async (repeated) => {
  const client = {
    async threadTurnsList(request: Request): Promise<Page> {
      return { data: [], nextCursor: request.threadId === repeated ? "loop" : null }
    }
  }
  await expect(readLineage(client, fork)).rejects.toThrow("repeated a pagination cursor")
})

test("history failures are not misreported as a fork with no inherited turns", async () => {
  await expect(
    readLineage(
      {
        threadTurnsList: async () => {
          throw new Error("History unavailable")
        }
      },
      fork
    )
  ).rejects.toThrow("History unavailable")
})
