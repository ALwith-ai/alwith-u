/** Native, non-billable Provider regression. Use a fresh isolated U Dev instance. */
import assert from "node:assert/strict"
const socket = process.argv[2]
assert.ok(socket, "Pass the isolated instance's TAURI_HASGARD_SOCKET")
const script = `(async () => {
  const api = window.__TAURI_INTERNALS__;
  let connectionId = 'provider-smoke', nextId = 190100000;
  const frames = [], pending = new Map();
  const callback = api.transformCallback(event => {
    for (const line of event.payload) {
      const frame = JSON.parse(line); frames.push(frame);
      if (frame.connectionId === connectionId && pending.has(frame.id)) {
        const request = pending.get(frame.id); pending.delete(frame.id);
        clearTimeout(request.timer);
        frame.error ? request.reject(new Error(JSON.stringify(frame.error))) : request.resolve(frame.result);
      }
    }
  });
  const listener = await api.invoke('plugin:event|listen', {event:'runtime:lines',target:{kind:'Any'},handler:callback});
  async function request(method, params) {
    const id = ++nextId;
    let resolveReply, rejectReply;
    const result = new Promise((resolve,reject) => { resolveReply=resolve; rejectReply=reject; });
    const timer = setTimeout(() => rejectReply(new Error('Timed out: '+method)), 15000);
    pending.set(id,{resolve:resolveReply,reject:rejectReply,timer});
    try { await api.invoke('runtime_send',{connectionId,line:JSON.stringify({id,method,params})}); return await result; }
    finally { clearTimeout(timer); pending.delete(id); }
  }
  try {
    const initial = await api.invoke('providers_read');
    if (initial.revision !== 0 || Object.keys(initial.providers).length) throw new Error('Use a fresh isolated provider store');
    await api.invoke('runtime_start',{connectionId});
    await request('start',{agentId:'codex',launch:{engine:'codex'}});
    await request('initialize',{agentId:'codex',info:{name:'provider-smoke',version:'1'},capabilities:{}});
    const key = 'native-provider-smoke-private-token';
    const saved = await api.invoke('providers_save',{providerId:'qwen',input:{apiKey:key,region:'cn'},expectedRevision:0});
    const changed = await api.invoke('providers_save',{providerId:'qwen',input:{region:'intl'},expectedRevision:saved.revision});
    let staleRejected = false;
    try { await api.invoke('providers_save',{providerId:'qwen',input:null,expectedRevision:0}); }
    catch { staleRejected = true; }
    const read = await api.invoke('providers_read');
    const removed = await api.invoke('providers_save',{providerId:'qwen',input:null,expectedRevision:changed.revision});
    await api.invoke('runtime_start',{connectionId:'provider-smoke-replaced'});
    let oldConnectionRejected = false;
    try { await api.invoke('runtime_send',{connectionId,line:JSON.stringify({id:1,method:'ping'})}); }
    catch { oldConnectionRejected = true; }
    connectionId = 'provider-smoke-replaced';
    const ping = await request('ping');
    return {saved,changed,read,removed,staleRejected,oldConnectionRejected,ping,
      leaked:JSON.stringify({frames,saved,changed,read,removed}).includes(key),
      wireEvents:frames.filter(frame=>frame.type==='wire').length};
  } finally {
    await api.invoke('plugin:event|unlisten',{event:'runtime:lines',eventId:listener});
    api.unregisterCallback(callback);
  }
})()`
const child = Bun.spawn(["tauri-hasgard", "--socket", socket, "--window", "main", "--json", "eval", script], {
  stdout: "pipe",
  stderr: "pipe"
})
const [output, error, status] = await Promise.all([
  new Response(child.stdout).text(),
  new Response(child.stderr).text(),
  child.exited
])
assert.equal(status, 0, error)
const result = JSON.parse(output)
assert.equal(result.saved.status, "applied", JSON.stringify(result))
assert.equal(result.changed.status, "applied")
assert.equal(result.read.providers.qwen.region, "intl")
assert.equal(result.removed.status, "applied")
assert.deepEqual(result.removed.providers, {})
assert.equal(result.staleRejected, true)
assert.equal(result.oldConnectionRejected, true)
assert.equal(result.ping, "pong")
assert.equal(result.leaked, false)
assert.equal(result.wireEvents, 0)
console.log(
  "PASS: native credentials apply through the real adapter, region changes retain credentials, stale saves and window writes are rejected, and webview events contain no private token"
)
