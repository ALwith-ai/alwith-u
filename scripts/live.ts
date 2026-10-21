#!/usr/bin/env bun
// Live check against a real Codex login: two read-only conversations run
// concurrently and stay isolated; attach and a fresh agent both replay the original history.
import { mkdtemp, realpath, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { isFormElicitation, isStringProperty, isText, type Session, WebSocketRuntimeClient } from "@alwith/api"
import { ProcessRuntimeClient } from "@alwith/api/node"

import { CodexClient } from "../src/agent/client"
import { codexTurnId, codexTurnStartedAt } from "../src/agent/codex-extensions"
import { computerRuntimeEnv } from "../src/features/computer/runtime-config"
import { staged, stagedCodexEngine, startRuntime } from "./lib/runtime"

function isNotice(item: Session["items"][number]): boolean {
  if (item.kind !== "assistant") return false
  const codex = item._meta?.codex
  return typeof codex === "object" && codex !== null && (codex as { notice?: unknown }).notice === true
}

// Notices (warnings, reroutes) are not part of the persisted transcript, so replay omits them.
function assistantText(session: Session): string {
  return session.items
    .filter((item) => item.kind === "assistant" && !isNotice(item))
    .flatMap((item) => (item.kind === "assistant" ? item.content : []))
    .filter(isText)
    .map((block) => block.text)
    .join("")
}

async function until(predicate: () => boolean | Promise<boolean>, timeoutMs: number, what: string): Promise<void> {
  const start = Date.now()
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${what}`)
    await Bun.sleep(50)
  }
}

async function verifyHistory(client: CodexClient, directory: string, replies: Map<string, string>): Promise<void> {
  await client.listThreads({ reset: true })
  const projectThreads = await client.listProjectThreads(directory)
  if (projectThreads.some((thread) => thread.cwd !== directory))
    throw new Error("Project list includes another directory")
  for (const [id, original] of replies) {
    const exported = await client.exportHistory(id, () => {})
    const messages = exported
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string; message: { content: unknown } })
    const exportedText = messages
      .filter((message) => message.type === "assistant")
      .flatMap((message) => message.message.content as { type: string; text: string }[])
      .map((block) => block.text)
      .join("")
    if (exportedText.trim() !== original.trim() || messages.filter((message) => message.type === "user").length !== 1)
      throw new Error(`Read-only export of ${id} differs from the live transcript`)
    if (!projectThreads.some((thread) => thread.sessionId === id))
      throw new Error(`Thread ${id} missing from project list`)
    if (!client.state.threads.some((thread) => thread.sessionId === id))
      throw new Error(`Thread ${id} missing from session/list`)
    await client.open(id, directory)
    // WebSocket history notifications can arrive after open resolves, in separate batches.
    await until(
      () =>
        client.session(id).items.some((item) => item.kind === "user") &&
        assistantText(client.session(id)).trim() === original.trim(),
      10_000,
      `complete history replay for ${id}`
    )
    const replayed = client.session(id)
    const users = replayed.items.filter((item) => item.kind === "user").length
    if (users !== 1) throw new Error(`Expected one user message in ${id}, saw ${users}`)
    if (assistantText(replayed).trim() !== original.trim())
      throw new Error(`Replay of ${id} differs from the live transcript`)
  }
}

async function check(transport: "stdio" | "ws") {
  const directory = await realpath(await mkdtemp(join(tmpdir(), `alwith-u-live-${transport}-`)))
  await writeFile(join(directory, "README.md"), "# live check\n")
  console.log(`project: ${directory}`)

  const runtime = transport === "ws" ? await startRuntime(join(directory, "journal")) : null
  const port = runtime
    ? new WebSocketRuntimeClient(runtime.url, runtime.token)
    : new ProcessRuntimeClient({
        binary: staged("alwith-runtime"),
        engines: { codex: stagedCodexEngine() },
        journalRoot: join(directory, "journal")
      })
  console.log(`runtime: ${runtime?.url ?? "stdio"}`)
  const client = new CodexClient(() => Promise.resolve(port), {
    agentId: "codex",
    launch: { engine: "codex", env: { ...computerRuntimeEnv, INITIAL_AGENT_MODE: "read-only" } }
  })
  let second: CodexClient | undefined
  try {
    await client.connect()
    console.log(`agent: ${client.state.agent?.info.name} ${client.state.agent?.info.version}`)

    const draft = await client.prepareDraft("main", directory)
    if (!client.session(draft).configOptions.some((option) => option.category === "model"))
      throw new Error("Precreated draft has no model selector")
    if ((await client.listProjectThreads(directory)).some((thread) => thread.sessionId === draft))
      throw new Error("Precreated draft leaked into the project index")
    await client.discardDraft("main")
    if (client.state.sessions[draft]) throw new Error("Discarded draft is still attached")
    console.log("draft: real model options before sending; empty session cleaned up")

    const [a, b] = await Promise.all([client.prepareDraft("main", directory), client.prepareDraft("chat", directory)])
    await Promise.all([
      client.prompt(a, [
        {
          type: "text",
          text: "Reply with exactly the word ALPHA and nothing else."
        }
      ]),
      client.prompt(b, [
        {
          type: "text",
          text: "Reply with exactly the word BRAVO and nothing else."
        }
      ])
    ])
    if (client.state.draftSessions[a] || client.state.draftSessions[b])
      throw new Error("Accepted prompts did not materialize the drafts")
    await client.discardDraft("main")
    if (!client.state.sessions[a]) throw new Error("Discard removed a submitted conversation")
    await until(
      () => client.session(a).state === "idle" && client.session(b).state === "idle",
      120_000,
      "both turns to finish"
    )
    const replyA = assistantText(client.session(a))
    const replyB = assistantText(client.session(b))
    console.log(`A: ${replyA.trim()}`)
    console.log(`B: ${replyB.trim()}`)
    if (!replyA.includes("ALPHA") || replyA.includes("BRAVO"))
      throw new Error("Session A did not receive its own reply")
    if (!replyB.includes("BRAVO") || replyB.includes("ALPHA"))
      throw new Error("Session B did not receive its own reply")

    // A second client on the same Runtime attaches to the running agent instead of restarting it,
    // and replays the initialize response without a second handshake.
    second = new CodexClient(() => Promise.resolve(port), { agentId: "codex", launch: { engine: "codex" } })
    client.disconnect()
    await until(() => client.state.connection === "disconnected", 10_000, "disconnect")
    await second.connect()
    if (second.state.agent?.info.name !== "@nyssance/codex-acp-v2") throw new Error("initialize state was not replayed")
    const replies = new Map([
      [a, replyA],
      [b, replyB]
    ])
    await verifyHistory(second, directory, replies)
    console.log("attach: replay matches live transcripts")

    second.disconnect()
    await port.stop("codex")
    // The raw stop command acknowledges the request; registry removal confirms actual exit.
    await until(async () => !(await port.agents()).some((agent) => agent.agentId === "codex"), 10_000, "agent exit")
    second = new CodexClient(() => Promise.resolve(port), {
      agentId: "codex",
      launch: { engine: "codex", env: { ...computerRuntimeEnv, INITIAL_AGENT_MODE: "read-only" } }
    })
    await second.connect()
    await verifyHistory(second, directory, replies)
    console.log("fresh agent: native history matches live transcripts")
    const boundary = second.session(a).items.find((item) => item.kind === "assistant" && !isNotice(item))
    const turnId = codexTurnId(boundary?._meta)
    if (turnId === null) throw new Error("Restored answer is missing its Codex turn id")
    const originalTime = codexTurnStartedAt(boundary?._meta)
    if (originalTime === null) throw new Error("Restored answer is missing its original turn time")
    await second.prompt(a, [{ type: "text", text: "Reply with exactly AFTER_FORK_BOUNDARY" }])
    await until(
      () => second!.session(a).state === "idle" && assistantText(second!.session(a)).includes("AFTER_FORK_BOUNDARY"),
      120_000,
      "later source turn"
    )
    const sourceTitle = `Fork title ${crypto.randomUUID()}`
    await second.renameSession(a, sourceTitle)
    const forked = await second.fork(a, directory, turnId)
    try {
      await until(
        () =>
          second!.session(forked).items.some((item) => item.kind === "user") &&
          assistantText(second!.session(forked)).trim() === replyA.trim(),
        10_000,
        "fork history updates"
      )
      const forkSession = second.session(forked)
      if (forkSession.title !== `${sourceTitle} (2)` || second.session(a).title !== sourceTitle)
        throw new Error("Fork did not persist a distinct inherited title")
      if (second.state.forkOrigins[forked]?.boundaryTurnId !== turnId)
        throw new Error("Fork did not identify the inherited turn boundary")
      if (
        forkSession.items.some(
          (item) => codexTurnId(item._meta) === turnId && codexTurnStartedAt(item._meta) !== originalTime
        )
      )
        throw new Error("Fork changed the original turn time")
      if (
        forkSession.items.filter((item) => item.kind === "user").length !== 1 ||
        assistantText(forkSession).trim() !== replyA.trim()
      )
        throw new Error("Fork did not stop at the selected answer")
      const branches = await second.listProjectThreads(directory)
      if (![a, forked].every((id) => branches.some((thread) => thread.sessionId === id)))
        throw new Error("Native branch index is missing the source or fork")
      if (branches.find((thread) => thread.sessionId === forked)?.forkedFromId !== a)
        throw new Error("Fork lineage does not point to the source")
      await second.close(forked)
      // A fork must survive a full agent restart before the user sends anything in it.
      second.disconnect()
      await port.stop("codex")
      await until(
        async () => !(await port.agents()).some((agent) => agent.agentId === "codex"),
        10_000,
        "new fork agent exit"
      )
      second = new CodexClient(() => Promise.resolve(port), {
        agentId: "codex",
        launch: { engine: "codex", env: { ...computerRuntimeEnv, INITIAL_AGENT_MODE: "read-only" } }
      })
      await second.connect()
      const immediatelySaved = await second.readThreadSummary(forked)
      if (immediatelySaved?.title !== `${sourceTitle} (2)`)
        throw new Error("Fork or title was not saved before the first child prompt")
      await second.open(forked, directory)
      await until(() => assistantText(second!.session(forked)).trim().length > 0, 10_000, "reopened fork updates")
      if (assistantText(second.session(forked)).trim() !== replyA.trim())
        throw new Error("Fork history changed after reopening")
      await second.prompt(forked, [{ type: "text", text: "Reply with exactly FORK_CONTINUED" }])
      await until(
        () =>
          second!.session(forked).state === "idle" && assistantText(second!.session(forked)).includes("FORK_CONTINUED"),
        120_000,
        "fork continuation"
      )
      await second.open(a, directory)
      if (assistantText(second.session(a)).includes("FORK_CONTINUED"))
        throw new Error("Fork response leaked into the source")
      await second.close(forked)
      second.disconnect()
      await port.stop("codex")
      await until(
        async () => !(await port.agents()).some((agent) => agent.agentId === "codex"),
        10_000,
        "fork agent exit"
      )
      second = new CodexClient(() => Promise.resolve(port), {
        agentId: "codex",
        launch: { engine: "codex", env: { ...computerRuntimeEnv, INITIAL_AGENT_MODE: "read-only" } }
      })
      await second.connect()
      if (!(await second.listProjectThreads(directory)).some((thread) => thread.sessionId === forked))
        throw new Error("Continued fork is missing from the persisted native list")
      await second.open(forked, directory)
      await until(
        () => assistantText(second!.session(forked)).includes("FORK_CONTINUED"),
        10_000,
        "persisted fork updates"
      )
      if (!assistantText(second.session(forked)).includes("FORK_CONTINUED"))
        throw new Error("Fork continuation was not persisted across agent restart")
      if (
        second.state.forkOrigins[forked]?.boundaryTurnId !== turnId ||
        second.session(forked).title !== `${sourceTitle} (2)`
      )
        throw new Error("Fork origin or title changed after continuation and restart")
      if (
        second
          .session(forked)
          .items.some((item) => codexTurnId(item._meta) === turnId && codexTurnStartedAt(item._meta) !== originalTime)
      )
        throw new Error("Fork history time changed after restart")
      console.log(
        "fork: immediate persistence, counted title, inherited boundary, isolated continuation and restart verified"
      )
    } finally {
      await second.delete(forked)
    }
    const events = await port.sessionEvents(a)
    if (events.length === 0) throw new Error("the Runtime journal has no frames for session A")
    console.log(`journal: ${events.length} frames for A, last sequence ${events.at(-1)!.sequence}`)
    const states = await port.runStates()
    console.log(`run states: ${states.map((state) => `${state.sessionId.slice(0, 8)}=${state.state}`).join(", ")}`)
    // Session close must retire only its Runtime record, including when the session is idle.
    // Unsent native drafts have no persisted rollout to reopen; use materialized conversations.
    const closeTarget = a
    const survivor = b
    await second.open(closeTarget, directory)
    await second.open(survivor, directory)
    const retainedText = assistantText(second.session(closeTarget))
    await second.stopSession(closeTarget)
    if (second.session(closeTarget).attached || assistantText(second.session(closeTarget)) !== retainedText)
      throw new Error("Stopping a session did not retain its detached transcript")
    await until(
      async () => !(await port.runStates()).some((state) => state.sessionId === closeTarget),
      10_000,
      "idle session removal"
    )
    if (!(await port.runStates()).some((state) => state.sessionId === survivor))
      throw new Error("Closing one session removed its sibling")
    await second.open(closeTarget, directory)
    await Promise.all([
      second.prompt(closeTarget, [{ type: "text", text: "Count from 1 to 1000, one number per line." }]),
      second.prompt(survivor, [{ type: "text", text: "Reply with exactly CLOSE_SURVIVOR." }])
    ])
    await second.stopSession(closeTarget)
    await until(
      async () => !(await port.runStates()).some((state) => state.sessionId === closeTarget),
      10_000,
      "running session removal"
    )
    await until(
      () =>
        second!.session(survivor).state === "idle" &&
        assistantText(second!.session(survivor)).includes("CLOSE_SURVIVOR"),
      120_000,
      "sibling completion after close"
    )
    if (!(await port.agents()).some((agent) => agent.agentId === "codex"))
      throw new Error("Session close killed the shared agent")
    await second.open(closeTarget, directory)
    if (!second.session(closeTarget).attached) throw new Error("Closed session could not reopen")
    await second.close(closeTarget)
    await second.close(survivor)
    console.log("close: idle and running sessions retire independently; sibling completes and closed history reopens")
    await verifyUserInput(second, directory)
  } finally {
    client.disconnect()
    second?.disconnect()
    const exited =
      port instanceof ProcessRuntimeClient
        ? new Promise<void>((resolve) => port.onProcessExit(() => resolve()))
        : runtime
          ? new Promise<void>((resolve) => runtime.process.once("exit", () => resolve()))
          : Promise.resolve()
    port.close()
    runtime?.stop()
    await exited
  }
}

async function verifyUserInput(client: CodexClient, directory: string): Promise<void> {
  const id = await client.newSession(directory)
  try {
    await client.setConfig(id, "collaboration_mode", "default")
    await client.prompt(id, [
      {
        type: "text",
        text: 'UI integration test: use the request_user_input tool now, in Default mode. Ask exactly one question with id "choice", header "Scope", question "Which implementation should be used?", and two options labelled "Alpha" and "Beta" with short descriptions. Do not write the question as a prose message. Wait for my answer, then reply with exactly CHOICE_BETA if I chose Beta. Do not use other tools or change files.'
      }
    ])
    await until(
      () => client.state.actions.some((action) => action.sessionId === id),
      120_000,
      "Default-mode structured question"
    )
    const action = client.state.actions.find((action) => action.sessionId === id)
    if (action?.kind !== "elicitation" || !isFormElicitation(action.params))
      throw new Error(`Expected a structured question in Default mode, received: ${assistantText(client.session(id))}`)
    const choice = action.params.requestedSchema.properties?.choice
    if (!choice || !isStringProperty(choice) || !choice.oneOf?.some((option) => option.const === "Beta"))
      throw new Error("The structured question is missing its selectable Beta answer")
    // Default-mode questions may be non-blocking; the pending request owns the form,
    // independently of whether Runtime keeps the turn running while awaiting input.
    client.respond(action.id, { action: "accept", content: { choice: "Beta" } })
    await until(
      () => client.session(id).state === "idle" && assistantText(client.session(id)).includes("CHOICE_BETA"),
      120_000,
      "structured answer completion"
    )
    console.log("question: Default mode emits an ACP form and receives the selected answer")
  } finally {
    await client.delete(id)
  }
}

for (const transport of ["stdio", "ws"] as const) await check(transport)
