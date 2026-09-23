import { expect, test } from "bun:test"
import type { ComposerDraft } from "@/features/chat/composer/drafts"
import type { ChatTransfer } from "@/lib/chat-window"
import { selectThread, type SelectThreadActions } from "../select-thread"

const thread = {
  sessionId: "history-1",
  cwd: "/tmp/project",
  title: "History",
  updatedAt: null,
  archived: false
}

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

function actions(open: () => Promise<void>, selected: string[], errors: unknown[]): SelectThreadActions {
  return {
    connect: async () => {},
    unarchive: async () => {},
    release: async (): Promise<ChatTransfer | null> => null,
    importDraft: (_id: string, _draft: ComposerDraft | null) => {},
    open: async () => open(),
    show: id => selected.push(id),
    onOpenError: error => errors.push(error)
  }
}

test("selects a chat while its history is still restoring", async () => {
  const restoration = deferred()
  const selected: string[] = []
  const errors: unknown[] = []

  await selectThread(
    thread,
    actions(() => restoration.promise, selected, errors)
  )

  expect(selected).toEqual(["history-1"])
  expect(errors).toEqual([])
  restoration.resolve()
  await restoration.promise
})

test("reports a background restore failure after selecting the chat", async () => {
  const restoration = deferred()
  const selected: string[] = []
  const errors: unknown[] = []
  const failure = new Error("resume failed")

  await selectThread(
    thread,
    actions(() => restoration.promise, selected, errors)
  )
  restoration.reject(failure)
  await Promise.resolve()
  await Promise.resolve()

  expect(selected).toEqual(["history-1"])
  expect(errors).toEqual([failure])
})
