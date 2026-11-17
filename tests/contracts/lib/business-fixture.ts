/** Resettable business fixtures with server-owned outcome checks, never real accounts. */
export function businessFixture() {
  const state = {
    draft: { subject: "Re: Quarterly reconciliation", body: "Original quoted text", attachment: "" },
    draftWrites: 0,
    sends: 0,
    document: "Original project update",
    documentWrites: 0,
    records: [
      { id: "A-17", name: "North", value: "Pending" },
      { id: "A-18", name: "North", value: "Pending" }
    ],
    adminWrites: 0
  }
  const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;")
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/save") {
        const body = (await request.json()) as Record<string, string>
        if (body.kind === "draft") {
          state.draft = { subject: body.subject!, body: body.body!, attachment: body.attachment! }
          state.draftWrites++
        } else if (body.kind === "send") state.sends++
        else if (body.kind === "document") {
          state.document = body.body!
          state.documentWrites++
        } else if (body.kind === "admin") {
          const record = state.records.find((record) => record.id === body.id)
          if (!record) return new Response("Unknown record", { status: 404 })
          record.value = body.value!
          state.adminWrites++
          // The server committed, but the client cannot know from this response.
          if (url.searchParams.has("drop"))
            return new Response("Gateway lost the commit acknowledgement", { status: 502 })
        } else return new Response("Unknown operation", { status: 400 })
        return Response.json({ saved: true })
      }
      const save = `async function save(body,drop=false){const r=await fetch('/save'+(drop?'?drop':''),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error('Save response missing');return r.json()}`
      let html = ""
      if (url.pathname === "/")
        html =
          '<h1>Business fixtures</h1><a href="/mail">Mail</a><a href="/document">Collaboration document</a><a href="/admin">Administration</a>'
      else if (url.pathname === "/mail")
        html = `<h1>Inbox</h1><a href="/thread">Quarterly reconciliation</a><a href="/draft">Saved draft</a><p>Draft saves: ${state.draftWrites}</p>`
      else if (url.pathname === "/thread")
        html =
          '<h1>Quarterly reconciliation</h1><p>Please confirm the totals and attach the evidence.</p><a href="/draft">Reply as draft</a>'
      else if (url.pathname === "/draft")
        html = `<h1>Draft</h1><label>Subject<input id="subject" value="${escape(state.draft.subject)}"></label><div id="body" contenteditable="true" role="textbox" aria-label="Body">${escape(state.draft.body)}</div><label>Attachment<input id="attachment" type="file"></label><p id="attachment-status">${escape(state.draft.attachment ? "Attached: " + state.draft.attachment : "No attachment")}</p><button id="save">Save draft</button><button id="send">Send</button><p role="status">Ready</p><a href="/mail">Inbox</a><script>
        ${save};let attachment=${JSON.stringify(state.draft.attachment)};
        document.querySelector('#attachment').onchange=async e=>{attachment=await e.target.files[0].text();document.querySelector('#attachment-status').textContent='Attached: '+attachment};
        document.querySelector('#save').onclick=async()=>{await save({kind:'draft',subject:document.querySelector('#subject').value,body:document.querySelector('#body').innerText,attachment});document.querySelector('[role=status]').textContent='Draft saved'};
        document.querySelector('#send').onclick=()=>save({kind:'send'});
        </script>`
      else if (url.pathname === "/document")
        html = `<h1>Project update</h1><iframe title="Document editor" src="http://localhost:${server.port}/editor"></iframe>`
      else if (url.pathname === "/editor")
        html = `<div id="body" contenteditable="true" role="textbox" aria-label="Project text">${escape(state.document)}</div><button id="save">Save document</button><p role="status">Ready</p><script>${save};document.querySelector('#save').onclick=async()=>{await save({kind:'document',body:document.querySelector('#body').innerText});document.querySelector('[role=status]').textContent='Document saved'}</script>`
      else if (url.pathname === "/admin")
        html = `<h1>Records</h1><table><thead><tr><th>ID</th><th>Name</th><th>Status</th><th>Action</th></tr></thead><tbody>${state.records.map((record) => `<tr><td>${record.id}</td><td>${record.name}</td><td>${escape(record.value)}</td><td><a href="/record?id=${record.id}${url.searchParams.has("drop") ? "&drop" : ""}">Edit ${record.id}</a></td></tr>`).join("")}</tbody></table>`
      else if (url.pathname === "/record") {
        const record = state.records.find((record) => record.id === url.searchParams.get("id"))
        if (!record) return new Response("Unknown record", { status: 404 })
        html = `<h1>Record ${record.id}</h1><label>Status<input id="value" value="${escape(record.value)}"></label><button id="save">Save record</button><p role="status">Ready</p><a href="/admin">All records</a><script>${save};document.querySelector('#save').onclick=async()=>{try{await save({kind:'admin',id:${JSON.stringify(record.id)},value:document.querySelector('#value').value},${url.searchParams.has("drop")});document.querySelector('[role=status]').textContent='Record saved'}catch{document.querySelector('[role=status]').textContent='Response lost: check saved record before retrying'}}</script>`
      } else return new Response("Not found", { status: 404 })
      return new Response(
        `<!doctype html><meta charset="utf-8"><title>Isolated business workspace</title><style>body{font:16px sans-serif;padding:20px}input,button,a,[contenteditable]{margin:8px}iframe{width:650px;height:300px}[contenteditable]{white-space:pre-wrap;min-height:60px;border:1px solid}td,th{padding:8px}</style>${html}`,
        { headers: { "Content-Type": "text/html" } }
      )
    }
  })
  return { state, url: `http://127.0.0.1:${server.port}`, close: () => server.stop(true) }
}
