import type { ComposerDraft } from "@alwith/module-chat/conversation"
import { expect, test, vi } from "vitest"

import type { ChatTransfer } from "@/lib/chat-window"

import { selectSession, type SelectSessionActions } from "../select-session"

const sessionRow = {
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

function actions(open: () => Promise<void>, selected: string[], errors: unknown[]): SelectSessionActions {
  return {
    connect: async () => {},
    unarchive: async () => {},
    release: (): Promise<ChatTransfer | null> => Promise.resolve(null),
    importDraft: (_id: string, _draft: ComposerDraft | null) => {},
    include: () => {},
    open: async () => open(),
    show: (id) => selected.push(id),
    onOpenError: (error) => errors.push(error)
  }
}

test("selects a chat while its history is still restoring", async () => {
  const restoration = deferred()
  const selected: string[] = []
  const errors: unknown[] = []

  await selectSession(
    sessionRow,
    actions(() => restoration.promise, selected, errors)
  )

  expect(selected).toEqual(["history-1"])
  expect(errors).toEqual([])
  restoration.resolve()
  await restoration.promise
})

test("includes a selected project chat before showing it, after restoring an archived chat", async () => {
  const restoration = deferred()
  const selected: string[] = []
  const callbacks = actions(() => restoration.promise, selected, [])
  const include = vi.fn()
  callbacks.include = include
  callbacks.unarchive = () => {
    return Promise.try(() => {
      expect(include).not.toHaveBeenCalled()
    })
  }
  callbacks.show = (id) => {
    expect(include).toHaveBeenCalledExactlyOnceWith(sessionRow)
    selected.push(id)
  }
  await selectSession({ ...sessionRow, archived: true }, callbacks)
  expect(selected).toEqual([sessionRow.sessionId])
  restoration.resolve()
  await restoration.promise
})

test("reports a background restore failure after selecting the chat", async () => {
  const restoration = deferred()
  const selected: string[] = []
  const errors: unknown[] = []
  const failure = new Error("resume failed")

  await selectSession(
    sessionRow,
    actions(() => restoration.promise, selected, errors)
  )
  restoration.reject(failure)
  await Promise.resolve()
  await Promise.resolve()

  expect(selected).toEqual(["history-1"])
  expect(errors).toEqual([failure])
})
