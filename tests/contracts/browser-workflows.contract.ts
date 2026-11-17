/** Complete fixture workflows, checked against persisted server state. */
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

import { startTestRuntime } from "@alwith/api/node"
import { CodexClient, defineApplicationTool } from "@alwith/module-chat/client"
import { type Browser, chromium } from "playwright-core"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest"

import { staged, stagedCodexEngine } from "../../scripts/lib/runtime"
import { createWebAutomationTools } from "../../src/features/web-automation/application-tools"
import { type BrowserTools, createBrowserTools } from "../../src/features/web-automation/engine.mjs"
import { businessFixture } from "./lib/business-fixture"

describe("persisted browser workflows", () => {
  let browser: Browser
  let fixture: ReturnType<typeof businessFixture>
  let run: BrowserTools
  let directory: string
  let target = "business-fixture"
  let dispose: () => Promise<void>
  const native = process.env.BROWSER_WORKFLOWS_CEF === "1"
  const call = (name: string, args: Record<string, unknown> = {}) => run(name, { target, ...args })
  const ref = async (label: string) => {
    let result: { ref: string; snapshotId: string } | undefined
    // Loading child documents can invalidate an observation. Reobserve, never replay a write.
    await expect
      .poll(async () => {
        try {
          const snapshot = await call("browser_snapshot")
          const line = snapshot.text.split("\n").find((line: string) => line.includes(label))
          const reference = line?.match(/\[ref=([^\]]+)\]/)?.[1]
          if (reference) result = { ref: reference, snapshotId: snapshot.snapshotId }
          return Boolean(result)
        } catch (error) {
          if (String(error).includes("navigated during observation")) return false
          throw error
        }
      })
      .toBe(true)
    assert.ok(result)
    return result
  }
  const click = async (label: string) => call("browser_click", await ref(label))
  const fill = async (label: string, text: string) =>
    call("browser_type", { ...(await ref(label)), text, replace: true })
  const navigate = (path: string) => call("browser_navigate", { url: fixture.url + path })

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "alwith-business-"))
    await writeFile(join(directory, "evidence.txt"), "Evidence 2026-11")
    if (!native) browser = await chromium.launch({ headless: true })
  })
  beforeEach(async () => {
    fixture = businessFixture()
    if (native) {
      const { ipc, ui, requireBrowserFixture, conversations } = await import("./lib/app")
      await requireBrowserFixture()
      const guest = await ipc("cef_open_guest", { url: fixture.url })
      target = guest.label
      await ui(
        `(()=>{const e=document.createElement('embed');e.id='business-fixture';e.type='application/x-chromium-surface-embed';e.setAttribute('data-content-id',${JSON.stringify(guest.token)});e.style='position:fixed;left:20px;top:80px;width:900px;height:650px;z-index:999';document.body.append(e)})()`
      )
      const sessions = conversations("business-workflows")
      run = await sessions.agent()
      dispose = async () => {
        await sessions.close()
        await ui("document.querySelector('#business-fixture')?.remove()")
        await ipc("cef_close_guest", { label: target })
      }
    } else {
      const context = await browser.newContext()
      const page = await context.newPage()
      await page.goto(fixture.url)
      run = createBrowserTools(
        async () => {
          throw Error("Unexpected host operation")
        },
        async () => ({ contexts: () => [context], on: () => {}, close: () => context.close() }) as unknown as Browser
      )
      dispose = () => run.close()
    }
  })
  afterEach(async () => {
    await dispose()
    await fixture.close()
  })
  afterAll(async () => {
    await browser?.close()
    if (process.env.BROWSER_AI_LIVE === "1") console.log(`Live workflow evidence: ${directory}`)
    else await rm(directory, { recursive: true, force: true })
  })

  test.each([1, 2, 3, 4, 5])("mail draft with attachment survives reopening without sending, run %i", async () => {
    await navigate("/mail")
    await click('link "Quarterly reconciliation"')
    await click('link "Reply as draft"')
    await fill('textbox "Subject"', "Reconciled November")
    await fill('textbox "Body"', "Totals confirmed.\n附件已核对。")
    const page = await call("browser_read_page")
    expect(page.fileInputs).toMatchObject([{ id: "attachment" }])
    await call("browser_upload", { selector: "#attachment", paths: [join(directory, "evidence.txt")] })
    await call("browser_verify", {
      selector: "#attachment-status",
      condition: "text",
      expected: "Attached: Evidence 2026-11"
    })
    await click('button "Save draft"')
    await call("browser_verify", { selector: "[role=status]", condition: "text", expected: "Draft saved" })
    await click('link "Inbox"')
    await click('link "Saved draft"')
    await call("browser_verify", {
      ...(await ref('textbox "Body"')),
      condition: "text",
      expected: "Totals confirmed.\n附件已核对。"
    })
    expect(fixture.state).toMatchObject({
      draft: {
        subject: "Reconciled November",
        body: "Totals confirmed.\n附件已核对。",
        attachment: "Evidence 2026-11"
      },
      draftWrites: 1,
      sends: 0
    })
  })
  test.each([1, 2, 3, 4, 5])("cross-origin collaboration editing persists, run %i", async () => {
    await navigate("/document")
    await fill('textbox "Project text"', "Milestone complete.\n第二阶段开始。")
    await click('button "Save document"')
    await expect.poll(() => fixture.state.documentWrites).toBe(1)
    await call("browser_reload")
    await call("browser_verify", {
      ...(await ref('textbox "Project text"')),
      condition: "text",
      expected: "Milestone complete.\n第二阶段开始。"
    })
    expect(fixture.state.document).toBe("Milestone complete.\n第二阶段开始。")
  })
  test.each([1, 2, 3, 4, 5])(
    "a lost save response does not require replaying an administration write, run %i",
    async () => {
      await navigate("/admin?drop")
      await click('link "Edit A-18"')
      await fill('textbox "Status"', "Approved")
      await click('button "Save record"')
      await call("browser_verify", { selector: "[role=status]", condition: "contains_text", expected: "Response lost" })
      await call("browser_reload")
      await call("browser_verify", { ...(await ref('textbox "Status"')), condition: "value", expected: "Approved" })
      expect(fixture.state.records).toEqual([
        { id: "A-17", name: "North", value: "Pending" },
        { id: "A-18", name: "North", value: "Approved" }
      ])
      expect(fixture.state.adminWrites).toBe(1)
    }
  )
  test("closing the executor aborts a waiting action without later submitting", async () => {
    await navigate("/draft")
    await call("browser_evaluate", { expression: "document.querySelector('#save').disabled=true" })
    const pending = click('button "Save draft"').then(
      () => "completed",
      () => "aborted"
    )
    await Bun.sleep(100)
    await run.close()
    expect(await pending).toBe("aborted")
    expect(fixture.state.draftWrites).toBe(0)
  })

  const tasks = [
    {
      name: "mail",
      path: "/mail",
      instruction: () =>
        `Find Quarterly reconciliation. Prepare a reply draft with subject Reconciled November, body exactly "Totals confirmed.", and attach ${join(directory, "evidence.txt")}. Save it and reopen it to verify persistence. Do not send.`,
      check: () => {
        expect(fixture.state).toMatchObject({
          draft: { subject: "Reconciled November", body: "Totals confirmed.", attachment: "Evidence 2026-11" },
          draftWrites: 1,
          sends: 0
        })
      }
    },
    {
      name: "collaboration",
      path: "/document",
      instruction: () =>
        'Replace the project document text with exactly "Milestone complete.". Save it and reload to verify it persisted.',
      check: () => {
        expect(fixture.state.document).toBe("Milestone complete.")
        expect(fixture.state.documentWrites).toBe(1)
      }
    },
    {
      name: "administration",
      path: "/admin?drop",
      instruction: () =>
        "Set record A-18 status to Approved. Leave A-17 unchanged. If a save response is lost, inspect persisted data before deciding whether to retry. Verify the stored value.",
      check: () => {
        expect(fixture.state.records).toEqual([
          { id: "A-17", name: "North", value: "Pending" },
          { id: "A-18", name: "North", value: "Approved" }
        ])
        expect(fixture.state.adminWrites).toBe(1)
      }
    }
  ]
  for (const task of tasks)
    for (const repetition of [1, 2]) {
      test.skipIf(process.env.BROWSER_AI_LIVE !== "1")(
        `real Codex completes ${task.name}, run ${repetition}`,
        async () => {
          assert.ok(native, "Live workflow acceptance requires the isolated CEF fixture")
          await navigate(task.path)
          await using runtime = await startTestRuntime({
            binary: staged("alwith-runtime"),
            engines: { codex: stagedCodexEngine() },
            transport: "stdio",
            authFrom: process.env.CODEX_HOME ?? join(homedir(), ".codex")
          })
          let calls = 0
          const transcript: unknown[] = []
          const client = new CodexClient(() => Promise.resolve(runtime.client), {
            agentId: "codex",
            launch: { engine: "codex", env: { INITIAL_AGENT_MODE: "read-only", APP_SERVER_LOGS: directory } },
            applicationTools: createWebAutomationTools()
              .filter(
                (tool) =>
                  ![
                    "browser_open",
                    "browser_close",
                    "browser_focus",
                    "browser_cdp",
                    "browser_evaluate",
                    "browser_download",
                    "browser_visual",
                    "browser_screenshot"
                  ].includes(tool.name)
              )
              .map((definition) =>
                defineApplicationTool({
                  ...definition,
                  parse: (input: unknown) => input,
                  execute: async (input) => {
                    const args = input as Record<string, unknown>
                    if (definition.name !== "browser_list")
                      assert.equal(args.target, target, "Only the test guest is authorized")
                    if (definition.name === "browser_navigate")
                      assert.ok(String(args.url).startsWith(fixture.url + "/"))
                    if (definition.name === "browser_upload")
                      assert.deepEqual(args.paths, [join(directory, "evidence.txt")])
                    calls++
                    try {
                      const result =
                        definition.name === "browser_list"
                          ? { targets: [{ id: target, url: fixture.url + task.path }] }
                          : await call(definition.name, args)
                      transcript.push({ name: definition.name, args, result })
                      return {
                        isError: result?.ok === false && result?.pending !== true,
                        content: [{ type: "text", text: JSON.stringify(result) }]
                      }
                    } catch (error) {
                      transcript.push({ name: definition.name, args, error: String(error) })
                      return { isError: true, content: [{ type: "text", text: String(error) }] }
                    }
                  }
                })
              )
          })
          try {
            await client.connect()
            const id = await client.prepareDraft("main", runtime.workspace)
            const model = client.session(id).configOptions.find((option) => option.category === "model")
            await client.prompt(id, [
              {
                type: "text",
                text: `This is an authorized isolated website acceptance task. Use only browser application tools on target ${target}. Do not use shell, external services, or files except the specified upload. Start with browser_snapshot; use its refs with snapshotId. Reobserve after navigation or stale observations. Do not issue concurrent calls on the same target. An action reply is not proof of persistence: reopen or reload and verify the stored values. ${task.instruction()}`
              }
            ])
            const deadline = Date.now() + 180000
            while (client.session(id).state !== "idle" && Date.now() < deadline) {
              for (const action of client.state.actions) {
                const request = JSON.stringify(action)
                if (action.kind === "permission" && action.sessionId === id && request.includes("browser_"))
                  client.respond(action.id, { outcome: { outcome: "selected", optionId: "allow_once" } })
              }
              await Bun.sleep(100)
            }
            await writeFile(
              join(directory, `${task.name}-${repetition}-session.json`),
              JSON.stringify(client.session(id), null, 2)
            )
            assert.equal(client.session(id).state, "idle", "Agent did not finish within the workflow deadline")
            assert.ok(calls >= 3, "No complete browser workflow was executed")
            task.check()
            console.log(
              `Live workflow ${task.name} ${repetition}: ${calls} tool calls; model ${model && "currentValue" in model ? String(model.currentValue) : "unavailable"}`
            )
          } finally {
            await writeFile(
              join(directory, `${task.name}-${repetition}.json`),
              JSON.stringify({ transcript, state: fixture.state }, null, 2)
            )
            client.disconnect()
          }
        },
        240000
      )
    }
})
