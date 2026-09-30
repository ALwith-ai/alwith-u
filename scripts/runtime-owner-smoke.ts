/** macOS native regression: run against an isolated, logged-out U development instance. */
import assert from "node:assert/strict"

const socket = process.argv[2]
assert.ok(socket, "Pass the isolated instance's TAURI_HASGARD_SOCKET")
assert.equal(process.platform, "darwin", "This scenario uses the macOS Close Window shortcut")

async function hasgard(args: string[], window = "main") {
  const child = Bun.spawn(["tauri-hasgard", "--socket", socket, "--window", window, "--json", ...args], {
    stdout: "pipe",
    stderr: "pipe"
  })
  const [output, error, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited
  ])
  assert.equal(status, 0, error)
  return output.trim() === "" ? null : JSON.parse(output)
}
async function labels(): Promise<string[]> {
  return await hasgard(["ipc", "plugin:window|get_all_windows", "--args", "{}"])
}
async function ping() {
  const result = await hasgard([
    "eval",
    `(async () => {
    const api = window.__TAURI_INTERNALS__;
    const id = 190000001;
    let resolveReply, rejectReply;
    const reply = new Promise((resolve, reject) => { resolveReply = resolve; rejectReply = reject; });
    const callback = api.transformCallback(event => {
      for (const line of event.payload) {
        const frame = JSON.parse(line);
        if (frame.id === id) resolveReply(frame);
      }
    });
    const listener = await api.invoke('plugin:event|listen', {event:'runtime:lines',target:{kind:'Any'},handler:callback});
    const timeout = setTimeout(() => rejectReply(new Error('Runtime ping timed out')), 3000);
    try {
      await api.invoke('runtime_send', {connectionId:'owner-smoke',line:JSON.stringify({id,method:'ping'})});
      return await reply;
    } finally {
      clearTimeout(timeout);
      await api.invoke('plugin:event|unlisten', {event:'runtime:lines',eventId:listener});
      api.unregisterCallback(callback);
    }
  })()`
  ])
  assert.equal(result.error, null)
  assert.equal(result.result, "pong")
}

assert.deepEqual(await labels(), ["main"], "Use an isolated instance without a settings window")
await hasgard(["ipc", "runtime_start", "--args", JSON.stringify({ connectionId: "owner-smoke" })])
await ping()
await hasgard([
  "ipc",
  "plugin:webview|create_webview_window",
  "--args",
  JSON.stringify({
    options: { label: "settings", url: "index.html", title: "Runtime ownership regression", width: 300, height: 200 }
  })
])
assert.ok((await labels()).includes("settings"))
await hasgard(["press", "Meta+w", "--completion", "native"], "settings")
const deadline = Date.now() + 3000
while ((await labels()).includes("settings")) {
  assert.ok(Date.now() < deadline, "The auxiliary window must be destroyed")
  await Bun.sleep(20)
}
// Do not call runtime_start again: a restart would hide the ownership regression.
await ping()
console.log("PASS: destroying an auxiliary native window keeps the original Runtime responsive")
