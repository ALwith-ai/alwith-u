import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { expect, test } from "vitest"

import { ipc, requireBrowserFixture, rpc, ui, waitFor } from "./lib/app"

const evaluated = (window: string, script: string) => rpc("eval", { window, script })

function pdf(): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>",
    "<< /Length 16 >>\nstream\n10 10 80 80 re f\nendstream"
  ]
  let source = "%PDF-1.4\n%âãÏÓ\n"
  const offsets = objects.map((object, index) => {
    const offset = source.length
    source += `${index + 1} 0 obj\n${object}\nendobj\n`
    return offset
  })
  const xref = source.length
  source += "xref\n0 5\n0000000000 65535 f \n"
  source += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")
  return Buffer.from(source + `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`, "latin1")
}

test("routes links in the main and floating chat window to their designated surfaces", async () => {
  await requireBrowserFixture()
  const runtime = await ipc("runtime_capabilities")
  const original = String(await ui("location.href"))
  const root = await realpath(await mkdtemp(join(tmpdir(), "alwith-chat-links-")))
  const project = join(root, "project")
  const outside = join(root, "outside")
  const received = new Set<string>()
  const web = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      received.add(new URL(request.url).searchParams.get("surface") ?? "")
      return new Response("<title>Chat link contract</title><h1>Chat link contract</h1>", {
        headers: { "content-type": "text/html" }
      })
    }
  })
  const html = `<!doctype html><link rel="stylesheet" href="./report.css"><h1>Previewed HTML</h1>
    <script>addEventListener("load",()=>parent.postMessage({
      type:"chat-link-preview", css:getComputedStyle(document.body).getPropertyValue("--contract").trim()
    },"*"))</script>`
  try {
    await mkdir(join(project, "folder"), { recursive: true })
    await mkdir(outside, { recursive: true })
    await Promise.all([
      writeFile(join(project, "source.txt"), "first line\nlocated line\n"),
      writeFile(join(project, "folder", "inside.txt"), "inside"),
      writeFile(join(outside, "outside.txt"), "outside first\noutside content\n"),
      writeFile(join(project, "report.html"), html),
      writeFile(join(project, "report.css"), "body{--contract:project}"),
      writeFile(join(outside, "outside.html"), html),
      writeFile(join(outside, "report.css"), "body{--contract:outside}"),
      writeFile(join(project, "sample.pdf"), pdf()),
      writeFile(join(project, "table.csv"), "column,value\nexample,2\n"),
      writeFile(join(project, "notes.md"), "# Chat link markdown"),
      writeFile(join(project, "archive.zip"), Buffer.from("504b0506000000000000000000000000000000000000", "hex")),
      writeFile(join(project, "large.txt"), "A line in the large fixture.\n".repeat(650_000)),
      writeFile(join(project, "project.canvas"), JSON.stringify({ nodes: [], edges: [] })),
      writeFile(
        join(project, "image.png"),
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=",
          "base64"
        )
      )
    ])
    const address = new URL(original)
    address.searchParams.set("chat-links-workspace", project)
    address.searchParams.set("outside", outside)
    address.searchParams.set("web", web.url.href)
    await rpc("navigate", { window: "main", url: address.href })
    const fixtureReady = (window: string) =>
      evaluated(
        window,
        `new URL(location.href).searchParams.get('chat-links-workspace')===${JSON.stringify(project)} &&
          !!document.querySelector('[data-chat-links-fixture] a')`
      ).catch(() => false)
    await waitFor(() => fixtureReady("main"), "Missing fixture")
    await ui(`window.addEventListener("message",event=>{
      if(event.data?.type==="chat-link-preview")document.documentElement.dataset.chatHtml=event.data.css;
    })`)
    const failures: string[] = []
    async function verify(name: string, run: () => Promise<void>) {
      try {
        await run()
        console.log(`PASS ${name}`)
      } catch (error) {
        failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
        console.log(`FAIL ${failures.at(-1)}`)
      }
    }
    const focus = async (window: string) => {
      if (await evaluated(window, "!document.hidden").catch(() => false)) return
      try {
        await rpc("focus", { window, selector: "body" })
      } catch (error) {
        if (!(await evaluated(window, "!document.hidden").catch(() => false))) throw error
      }
    }
    const clickText = async (window: string, text: string, tag = "a") => {
      await focus(window)
      await waitFor(
        () =>
          evaluated(
            window,
            `(() => {
          document.querySelector('[data-contract-click]')?.removeAttribute('data-contract-click');
          const element = [...document.querySelectorAll(${JSON.stringify(tag)})].find(e => e.textContent.trim() === ${JSON.stringify(text)});
          if (!element) return false;
          element.setAttribute('data-contract-click','');
          return true;
        })()`
          ),
        `Missing link control ${text}`
      )
      return rpc("click", { window, selector: "[data-contract-click]" })
    }
    const selected = (name: string) =>
      waitFor(
        () =>
          ui(
            `[...document.querySelectorAll('[role=tab][aria-selected=true]')].some(e=>e.textContent.includes(${JSON.stringify(name)}))`
          ),
        `Missing selected tab ${name}`,
        5000
      )
    const treeSelection = () =>
      ui(
        `[...document.querySelectorAll('[data-file-path][aria-selected=true]')].map(e=>e.getAttribute('data-file-path'))`
      )
    await verify("main project file and source position", async () => {
      await clickText("main", "Source link")
      await selected("source.txt")
      await waitFor(() => ui(`document.querySelector('.monaco-editor .cursor') != null`), "Source editor missing")
      expect(await treeSelection()).toContain(join(project, "source.txt"))
    })
    await verify("main outside file preserves tree", async () => {
      const before = await treeSelection()
      await clickText("main", "Outside file")
      await selected("outside.txt")
      expect(await treeSelection()).toEqual(before)
      expect(await ui(`!!document.querySelector('[data-file-path$="/outside.txt"]')`)).toBe(false)
      await waitFor(
        () =>
          ui(
            `JSON.parse(localStorage.getItem(${JSON.stringify(`workspace:${project}`)}))?.activePath===${JSON.stringify(join(outside, "outside.txt"))}`
          ),
        "Outside file was not saved as the active preview tab"
      )
      expect(
        await ui(
          `[...document.querySelectorAll('[data-sonner-toast]')].some(e=>e.textContent.includes('Invalid workspace preferences'))`
        )
      ).toBe(false)
    })
    await verify("main project directory expands the active tree", async () => {
      await clickText("main", "Inside directory")
      await waitFor(
        () => ui(`!!document.querySelector('[data-file-path$="/folder/inside.txt"]')`),
        "Directory did not expand"
      )
    })
    for (const [legend, name, marker] of [
      ["Local HTML", "report.html", "project"],
      ["Outside HTML", "outside.html", "outside"]
    ]) {
      await verify(`main ${legend} renders its stylesheet`, async () => {
        await clickText("main", legend!)
        await selected(name!)
        await waitFor(
          () => ui(`document.documentElement.dataset.chatHtml===${JSON.stringify(marker)}`),
          "Missing HTML preview"
        )
      })
    }
    for (const [legend, name] of [
      ["PDF file", "sample.pdf"],
      ["Image file", "image.png"],
      ["Table file", "table.csv"],
      ["Markdown file", "notes.md"],
      ["Large file", "large.txt"],
      ["Archive file", "archive.zip"]
    ]) {
      await verify(`main ${legend} selects the file area`, async () => {
        await clickText("main", legend!)
        await selected(name!)
        if (name === "sample.pdf")
          await waitFor(() => ui(`!!document.querySelector('.pdfViewer canvas')`), "PDF did not render")
      })
    }
    await verify("main outside directory leaves the preview in place", async () => {
      await waitFor(
        async () => (await treeSelection()).includes(join(project, "archive.zip")),
        "The previous selection did not settle"
      )
      const before = await treeSelection()
      await clickText("main", "Outside directory")
      expect(await treeSelection()).toEqual(before)
    })
    await verify("main project canvas opens the board", async () => {
      await clickText("main", "Board file")
      await waitFor(
        () => ui(`!!document.querySelector('.workspace-pane-board,.board-pane,[data-board-canvas]')`),
        "Board did not open",
        4000
      )
    })
    await verify("main missing file reports its path", async () => {
      await clickText("main", "Missing file")
      await waitFor(
        () =>
          ui(`[...document.querySelectorAll('[data-sonner-toast]')].some(e=>e.textContent.includes('missing.txt'))`),
        "Missing file produced no error"
      )
    })
    await verify(
      runtime.embeddedBrowser
        ? "main remote link loads inside the embedded browser"
        : "main remote link reports unavailable browser capability",
      async () => {
        await clickText("main", "Web link")
        if (runtime.backend === "wry") {
          await waitFor(
            () => ui(`document.querySelector('[data-sonner-toast]')?.textContent.includes('内嵌浏览器')`),
            "Missing capability message"
          )
        } else {
          await waitFor(async () => received.has("main"), "Embedded browser did not load the page")
          await selected("Chat link contract")
        }
      }
    )
    const windows: string[] = await ipc("plugin:window|get_all_windows")
    const floatingExists = windows.includes("chat")
    if (floatingExists) {
      await focus("chat")
      await rpc("navigate", { window: "chat", url: address.href })
    } else await clickText("main", "Open fixture floating chat", "button")
    await waitFor(() => fixtureReady("chat"), "Missing floating chat")
    await focus("chat")
    for (const [legend, path] of [
      ["Source link", join(project, "source.txt")],
      ["Inside directory", join(project, "folder")],
      ["Outside file", join(outside, "outside.txt")],
      ["Outside directory", outside],
      ["Local HTML", join(project, "report.html")],
      ["Outside HTML", join(outside, "outside.html")],
      ["PDF file", join(project, "sample.pdf")],
      ["Image file", join(project, "image.png")],
      ["Table file", join(project, "table.csv")],
      ["Markdown file", join(project, "notes.md")],
      ["Large file", join(project, "large.txt")],
      ["Archive file", join(project, "archive.zip")],
      ["Board file", join(project, "project.canvas")]
    ]) {
      await verify(`chat ${legend} invokes the system opener`, async () => {
        await clickText("chat", legend!)
        await waitFor(
          async () => {
            await focus("chat")
            return evaluated(
              "chat",
              `(() => {
                if (document.querySelector('[data-system-opened]')?.dataset.systemOpened===${JSON.stringify(path)}) return true;
                if (${legend === "Board file"}) {
                  const error = [...document.querySelectorAll('[data-sonner-toast]')].find(e=>/default application|no application|no associated|LSApplicationNotFound|10814|project\\.canvas.*ExitStatus/i.test(e.textContent));
                  if (error) return error.textContent;
                }
                return false;
              })()`
            ).catch(() => false)
          },
          "System opener did not complete",
          20000
        )
      })
    }
    await verify("chat app bundle uses the system opener", async () => {
      await clickText("chat", "App bundle")
      await waitFor(async () => {
        await focus("chat")
        return evaluated(
          "chat",
          `document.querySelector('[data-system-opened]')?.dataset.systemOpened==="/System/Applications/Calculator.app"`
        )
      }, "System opener did not complete for the app bundle")
    })
    await verify("chat guide opens the requested chapter", async () => {
      await clickText("chat", "Guide link")
      await waitFor(
        () => evaluated("guide", "location.pathname.endsWith('guide.html')").catch(() => false),
        "Guide did not open"
      )
    })
    await verify("chat missing file reports a system error", async () => {
      await clickText("chat", "Missing file")
      await waitFor(
        () => evaluated("chat", `!!document.querySelector('[data-sonner-toast]')`),
        "Missing file produced no error"
      )
    })
    await verify("chat remote link loads in the system browser", async () => {
      await clickText("chat", "Web link")
      await waitFor(async () => received.has("chat"), "System browser did not load the page")
    })
    expect(failures).toEqual([])
  } finally {
    web.stop(true)
    await rm(root, { recursive: true, force: true })
  }
}, 180_000)
