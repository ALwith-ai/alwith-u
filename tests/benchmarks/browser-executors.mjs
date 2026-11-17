/** Manual, isolated executor comparison. No model, user profile, or production adapter. */
import assert from "node:assert/strict"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { chromium } from "playwright-core"

const binary = process.env.AGENT_BROWSER_BIN
const chrome = process.env.EVAL_CHROME
if (!binary || !chrome) throw Error("Set AGENT_BROWSER_BIN and EVAL_CHROME to explicit executable paths")
const repeats = Number(process.env.EVAL_REPEATS ?? 5)
assert.ok(Number.isInteger(repeats) && repeats > 0)
const directory = await mkdtemp(join(tmpdir(), "alwith-executor-eval-"))
const config = join(directory, "agent-browser.json")
await writeFile(config, "{}")
await writeFile(join(directory, "runner.mjs"), await readFile(new URL(import.meta.url)))
const upload = join(directory, "fixture.txt")
await writeFile(upload, "isolated attachment evidence")
const states = new Map()
const records = []
let base

// Results come from fixture events posted to the server, never from an executor's success response.
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    const run = url.searchParams.get("run")
    if (url.pathname === "/state") {
      if (request.method === "POST") {
        const state = states.get(run) ?? {}
        Object.assign(state, await request.json())
        states.set(run, state)
      }
      return Response.json(states.get(run) ?? {})
    }
    if (url.pathname === "/file")
      return new Response("download evidence", {
        headers: { "Content-Type": "text/plain", "Content-Disposition": "attachment; filename=evidence.txt" }
      })
    const record = `const post=v=>fetch('/state?run='+encodeURIComponent(${JSON.stringify(run)}),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(v)});`
    if (url.pathname === "/frame")
      return new Response(
        `<button id="inside" onclick="post({frame:1})">${url.hostname === "localhost" ? "Cross frame save" : "Frame save"}</button><script>${record}</script>`,
        { headers: { "Content-Type": "text/html" } }
      )
    return new Response(
      `<!doctype html><meta charset="utf-8"><title>Executor fixture</title>
    <label>Entry<input id="entry" aria-label="Entry"></label>
    <textarea id="multi" aria-label="Multiline"></textarea>
    <div id="rich" contenteditable="true" role="textbox" aria-label="Draft" style="white-space:pre-wrap;border:1px solid;width:300px;min-height:50px">Original draft</div>
    <button id="save">Save</button><button id="alert">Confirm</button>
    <label><input id="check" type="checkbox">Approved</label>
    <select id="select"><option value="a">Alpha</option><option value="b">Beta</option></select>
    <input id="upload" type="file"><a id="download" href="/file" download>Download</a>
    <button id="replace">Replace row</button><button id="row">Old row</button>
    <button class="duplicate">Duplicate</button><button class="duplicate">Duplicate</button>
    <div id="shadow"></div><iframe id="frame" src="${base}/frame?run=${run}"></iframe>
    <iframe id="cross" src="${base.replace("127.0.0.1", "localhost")}/frame?run=${run}"></iframe>
    <p id="status">Pending</p><button id="disabled" disabled>Disabled</button>
    <div style="height:1000px"></div><button id="bottom">Bottom</button>
    <script>${record}
    const report=e=>post({[e.target.id]:e.target.isContentEditable?e.target.innerText:e.target.type==='checkbox'?e.target.checked:e.target.value});
    for(const id of ['entry','multi','rich','check','select']) {document.getElementById(id).addEventListener('input',report);document.getElementById(id).addEventListener('change',report)}
    document.querySelector('#save').onclick=()=>{const count=Number(document.body.dataset.count||0)+1;document.body.dataset.count=count;post({writes:count,saved:document.querySelector('#entry').value});setTimeout(()=>{document.querySelector('#status').textContent='Saved'},150)};
    document.querySelector('#alert').onclick=()=>post({confirmed:confirm('Proceed?')});
    document.querySelector('#upload').onchange=async e=>post({file:await e.target.files[0].text()});
    document.querySelector('#replace').onclick=()=>{document.querySelector('#row').outerHTML='<button id="row" onclick="post({wrongRow:1})">New row</button>'};
    document.querySelector('#row').onclick=()=>post({oldRow:1});
    document.querySelectorAll('.duplicate').forEach(e=>e.onclick=()=>post({ambiguousClick:1}));
    document.querySelector('#bottom').onclick=()=>post({bottom:1});
    document.querySelector('#disabled').onclick=()=>post({enabledClick:1});
    document.querySelector('#shadow').attachShadow({mode:'open'}).innerHTML='<button id="shadowButton">Shadow save</button>';
    document.querySelector('#shadow').shadowRoot.querySelector('button').onclick=()=>post({shadow:1});
    window.setup=kind=>{
      if(kind==='cover') {const c=document.createElement('div');c.id='cover';c.style='position:fixed;inset:0;background:white;z-index:999';document.body.append(c);setTimeout(()=>c.remove(),800)}
      if(kind==='delayed') {document.querySelector('#save').remove();setTimeout(()=>{const b=document.createElement('button');b.id='late';b.textContent='Late save';b.onclick=()=>post({late:1});document.body.append(b)},800)}
      if(kind==='enabled')setTimeout(()=>document.querySelector('#disabled').disabled=false,800);
    };
    post({ready:true});
    </script>`,
      { headers: { "Content-Type": "text/html" } }
    )
  }
})
base = `http://127.0.0.1:${server.port}`
const browserProcess = Bun.spawn(
  [
    chrome,
    "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    `--user-data-dir=${join(directory, "profile")}`,
    "about:blank"
  ],
  { stdout: "ignore", stderr: Bun.file(join(directory, "chrome.log")) }
)
let endpoint
for (let i = 0; i < 100; i++) {
  try {
    const [port, path] = (await readFile(join(directory, "profile/DevToolsActivePort"), "utf8")).trim().split("\n")
    endpoint = `ws://127.0.0.1:${port}${path}`
    break
  } catch {
    await Bun.sleep(100)
  }
}
if (!endpoint) {
  browserProcess.kill()
  throw Error(`Chromium failed to start; inspect ${directory}/chrome.log`)
}

async function poll(check, timeout = 3500) {
  const deadline = Date.now() + timeout
  do {
    if (await check()) return
    await Bun.sleep(25)
  } while (Date.now() < deadline)
  throw Error("Independent fixture oracle timed out")
}

async function executor(kind) {
  let calls = 0
  let bytes = 0
  if (kind === "playwright") {
    const browser = await chromium.connectOverCDP(endpoint)
    const page = browser.contexts()[0].pages()[0]
    page.setDefaultTimeout(3000)
    page.setDefaultNavigationTimeout(15000)
    let frame = page
    const counted =
      (fn) =>
      async (...args) => {
        calls++
        const value = await fn(...args)
        bytes += Buffer.byteLength(JSON.stringify(value ?? null))
        return value
      }
    return {
      goto: counted((url) => {
        frame = page
        return page.goto(url).then(() => {})
      }),
      eval: counted((expression) => page.evaluate(expression)),
      click: counted((selector) => frame.locator(selector).click()),
      fill: counted((selector, text) => frame.locator(selector).fill(text)),
      type: counted((selector, text) => frame.locator(selector).pressSequentially(text)),
      replaceByTyping: counted(async (selector, text) => {
        const locator = frame.locator(selector)
        await locator.click()
        await locator.press("ControlOrMeta+A")
        await locator.pressSequentially(text)
      }),
      replaceBySelection: counted(async (selector, text) => {
        await frame.locator(selector).click()
        await page.keyboard.press("ControlOrMeta+A")
        await page.keyboard.insertText(text)
      }),
      check: counted((selector) => frame.locator(selector).check()),
      select: counted((selector, value) => frame.locator(selector).selectOption(value)),
      upload: counted((selector, path) => frame.locator(selector).setInputFiles(path)),
      frame: counted((selector) => {
        frame = page.frameLocator(selector)
      }),
      snapshot: counted(() => page.ariaSnapshot({ mode: "ai" })),
      ref: (text) => {
        const line = text.split("\n").find((line) => line.includes("Old row"))
        const ref = line?.match(/\[ref=([^\]]+)\]/)?.[1]
        assert.ok(ref, text)
        return ref
      },
      clickRef: counted((ref) => page.getByRef(ref).click()),
      waitText: counted(() => page.locator("#status").filter({ hasText: "Saved" }).waitFor()),
      wait: counted((selector) => page.locator(selector).waitFor()),
      waitFunction: counted((expression) => page.waitForFunction(expression).then(() => {})),
      dialog: counted(async () => {
        page.once("dialog", (d) => void d.accept())
        await page.locator("#alert").click()
      }),
      download: counted(async (path) => {
        const pending = page.waitForEvent("download")
        await page.locator("#download").click()
        await (await pending).saveAs(path)
      }),
      close: () => browser.close(),
      metrics: () => ({ calls, outputBytes: bytes })
    }
  }
  const session = `eval-${crypto.randomUUID().slice(0, 8)}`
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("AGENT_BROWSER_")))
  Object.assign(env, { AGENT_BROWSER_SOCKET_DIR: join(directory, "sockets"), AGENT_BROWSER_DEFAULT_TIMEOUT: "3000" })
  async function command(...args) {
    calls++
    const child = Bun.spawn([binary, "--config", config, "--session", session, "--json", ...args], {
      cwd: directory,
      env,
      stdout: "pipe",
      stderr: "pipe"
    })
    const timer = setTimeout(() => child.kill(), 12000)
    try {
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited
      ])
      bytes += Buffer.byteLength(stdout)
      if (code !== 0) throw Error(`${args[0]}: ${stdout || stderr}`)
      const value = JSON.parse(stdout)
      if (!value.success) throw Error(JSON.stringify(value))
      return value.data
    } finally {
      clearTimeout(timer)
    }
  }
  await command("connect", endpoint)
  calls = 0
  bytes = 0
  return {
    goto: async (url) => {
      await command("frame", "main")
      return command("open", url)
    },
    eval: (expression) => command("eval", expression),
    click: (selector) => command("click", selector),
    fill: (selector, text) => command("fill", selector, text),
    type: (selector, text) => command("type", selector, text),
    check: (selector) => command("check", selector),
    replaceByTyping: (selector, text) => command("type", selector, text, "--clear"),
    replaceBySelection: async (selector, text) => {
      await command("click", selector)
      await command("press", process.platform === "darwin" ? "Meta+a" : "Control+a")
      await command("keyboard", "inserttext", text)
    },
    select: (selector, value) => command("select", selector, value),
    upload: (selector, path) => command("upload", selector, path),
    frame: (selector) => command("frame", selector),
    snapshot: async () => {
      const result = await command("snapshot")
      return result.snapshot
    },
    ref: (text) => {
      const line = text.split("\n").find((line) => line.includes("Old row"))
      const ref = line?.match(/\[ref=([^\]]+)\]/)?.[1]
      assert.ok(ref, text)
      return "@" + ref
    },
    clickRef: (ref) => command("click", ref),
    waitText: () => command("wait", "--text", "Saved"),
    wait: (selector) => command("wait", selector),
    waitFunction: (expression) => command("wait", "--fn", expression),
    dialog: async () => {
      await command("click", "#alert")
      await command("dialog", "accept")
    },
    download: (path) => command("download", "#download", path),
    close: () => command("close"),
    metrics: () => ({ calls, outputBytes: bytes })
  }
}

const cases = [
  [
    "input-replace",
    async (e) => {
      await e.fill("#entry", "你好 browser")
      return { entry: "你好 browser" }
    }
  ],
  [
    "input-append",
    async (e) => {
      await e.fill("#entry", "First")
      await e.type("#entry", "第二段")
      return { entry: "First第二段" }
    }
  ],
  [
    "textarea-multiline",
    async (e) => {
      await e.fill("#multi", "Line one\n第二行")
      return { multi: "Line one\n第二行" }
    }
  ],
  [
    "richtext-replace",
    async (e) => {
      await e.fill("#rich", "New draft")
      return { rich: "New draft" }
    }
  ],
  [
    "richtext-multiline",
    async (e) => {
      await e.fill("#rich", "Hello\n第二行")
      return { rich: "Hello\n第二行" }
    }
  ],
  [
    "checkbox-idempotent",
    async (e) => {
      await e.check("#check")
      await e.check("#check")
      return { check: true }
    }
  ],
  [
    "select-option",
    async (e) => {
      await e.select("#select", "b")
      return { select: "b" }
    }
  ],
  [
    "upload-content",
    async (e) => {
      await e.upload("#upload", upload)
      return { file: "isolated attachment evidence" }
    }
  ],
  [
    "download-content",
    async (e, id) => {
      const path = join(directory, id + ".txt")
      await e.download(path)
      assert.equal(await readFile(path, "utf8"), "download evidence")
      return {}
    }
  ],
  [
    "covered-button",
    async (e) => {
      await e.eval("setup('cover')")
      await e.click("#save")
      return { writes: 1 }
    }
  ],
  [
    "delayed-element",
    async (e) => {
      await e.eval("setup('delayed')")
      await e.click("#late")
      return { late: 1 }
    }
  ],
  [
    "disabled-to-enabled",
    async (e) => {
      await e.eval("setup('enabled')")
      await e.click("#disabled")
      return { enabledClick: 1 }
    }
  ],
  [
    "offscreen-click",
    async (e) => {
      await e.click("#bottom")
      return { bottom: 1 }
    }
  ],
  [
    "same-origin-frame",
    async (e) => {
      await e.frame("#frame")
      await e.click("#inside")
      return { frame: 1 }
    }
  ],
  [
    "cross-origin-frame",
    async (e) => {
      await e.frame("#cross")
      await e.click("#inside")
      return { frame: 1 }
    }
  ],
  [
    "shadow-dom",
    async (e) => {
      await e.click("#shadowButton")
      return { shadow: 1 }
    }
  ],
  [
    "save-and-wait",
    async (e) => {
      await e.fill("#entry", "Saved value")
      await e.click("#save")
      await e.waitText()
      return { writes: 1, saved: "Saved value" }
    }
  ],
  [
    "confirm-dialog",
    async (e) => {
      await e.dialog()
      return { confirmed: true }
    }
  ],
  [
    "ambiguous-selector",
    async (e) => {
      let rejected = false
      try {
        await e.click(".duplicate")
      } catch {
        rejected = true
      }
      assert.ok(rejected, "Ambiguous selector was accepted")
      return { ambiguousClick: undefined }
    }
  ],
  [
    "stale-row-reference",
    async (e) => {
      const snapshot = await e.snapshot()
      const ref = e.ref(snapshot)
      await e.click("#replace")
      let rejected = false
      try {
        await e.clickRef(ref)
      } catch {
        rejected = true
      }
      assert.ok(rejected, "Stale row reference was accepted")
      return { wrongRow: undefined, oldRow: undefined }
    }
  ]
]
// Explicit upstream waits distinguish missing automatic waits from missing capability.
cases.push(
  [
    "covered-explicit-wait",
    async (e) => {
      await e.eval("setup('cover')")
      await e.waitFunction("!document.querySelector('#cover')")
      await e.click("#save")
      return { writes: 1 }
    }
  ],
  [
    "delayed-explicit-wait",
    async (e) => {
      await e.eval("setup('delayed')")
      await e.wait("#late")
      await e.click("#late")
      return { late: 1 }
    }
  ],
  [
    "enabled-explicit-wait",
    async (e) => {
      await e.eval("setup('enabled')")
      await e.waitFunction("!document.querySelector('#disabled').disabled")
      await e.click("#disabled")
      return { enabledClick: 1 }
    }
  ],
  [
    "shadow-observed-reference",
    async (e) => {
      const snapshot = await e.snapshot()
      const line = snapshot.split("\n").find((line) => line.includes("Shadow save"))
      const ref = line?.match(/\[ref=([^\]]+)\]/)?.[1]
      assert.ok(ref, snapshot)
      await e.clickRef(e.kind === "agent-browser" ? "@" + ref : ref)
      return { shadow: 1 }
    }
  ],
  [
    "richtext-native-keyboard",
    async (e) => {
      await e.replaceByTyping("#rich", "New draft")
      return { rich: "New draft" }
    }
  ],
  [
    "richtext-select-all-insert",
    async (e) => {
      await e.replaceBySelection("#rich", "New draft")
      return { rich: "New draft" }
    }
  ],
  [
    "cross-frame-observed-reference",
    async (e) => {
      const snapshot = await e.snapshot()
      const line = snapshot.split("\n").find((line) => line.includes("Cross frame save"))
      const ref = line?.match(/\[ref=([^\]]+)\]/)?.[1]
      assert.ok(ref, snapshot)
      await e.clickRef(e.kind === "agent-browser" ? "@" + ref : ref)
      return { frame: 1 }
    }
  ]
)
const selected = process.env.EVAL_CASES?.split(",")
const activeCases = selected ? cases.filter(([name]) => selected.includes(name)) : cases
assert.ok(activeCases.length > 0, "No matching evaluation cases")

try {
  for (let iteration = 0; iteration < repeats; iteration++) {
    for (const kind of iteration % 2 ? ["agent-browser", "playwright"] : ["playwright", "agent-browser"]) {
      const e = await executor(kind)
      e.kind = kind
      try {
        for (const [name, execute] of activeCases) {
          const id = crypto.randomUUID()
          let failure
          let elapsedMs = 0
          let before
          let phase = "setup"
          try {
            await e.goto(`${base}/?run=${id}`)
            await poll(() => states.get(id)?.ready)
            before = e.metrics()
            phase = "action"
            const start = performance.now()
            try {
              const expected = await execute(e, id)
              await poll(() => Object.entries(expected).every(([key, value]) => states.get(id)?.[key] === value))
              // Allow incorrect late writes to arrive before declaring a rejection safe.
              if (name === "stale-row-reference" || name === "ambiguous-selector") await Bun.sleep(150)
              for (const [key, value] of Object.entries(expected)) assert.deepEqual(states.get(id)?.[key], value)
            } finally {
              elapsedMs = performance.now() - start
            }
          } catch (error) {
            failure = String(error)
          }
          const metrics = e.metrics()
          const row = {
            kind,
            name,
            iteration: iteration + 1,
            passed: !failure,
            phase,
            elapsedMs: Math.round(elapsedMs),
            calls: metrics.calls - (before?.calls ?? metrics.calls),
            outputBytes: metrics.outputBytes - (before?.outputBytes ?? metrics.outputBytes),
            failure,
            state: states.get(id)
          }
          records.push(row)
          console.log(
            `${kind} ${iteration + 1} ${name}: ${row.passed ? "PASS" : "FAIL"} ${row.elapsedMs}ms${failure ? " " + failure.slice(0, 160) : ""}`
          )
          await writeFile(
            join(directory, "results.json"),
            JSON.stringify(
              {
                scope: "Chromium CDP executor baseline; not CEF or model evaluation",
                chrome,
                binary,
                repeats,
                records
              },
              null,
              2
            )
          )
        }
      } finally {
        await e.close()
      }
    }
  }
} finally {
  browserProcess.kill()
  await browserProcess.exited
  await server.stop(true)
  console.log(`Evidence: ${directory}`)
}
const summary = activeCases.map(([name]) => ({
  name,
  ...Object.fromEntries(
    ["playwright", "agent-browser"].map((kind) => {
      const rows = records.filter((row) => row.name === name && row.kind === kind)
      return [kind, `${rows.filter((row) => row.passed).length}/${rows.length}`]
    })
  )
}))
await writeFile(join(directory, "summary.json"), JSON.stringify(summary, null, 2))
console.table(summary)
