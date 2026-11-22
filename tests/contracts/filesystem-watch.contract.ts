import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { test } from "vitest"

import { ipc, requireBrowserFixture, rpc, ui, waitFor } from "./lib/app"

test("closing another subscription to the workspace preserves live file tree updates", async () => {
  await requireBrowserFixture()
  const original = String(await ui("location.href"))
  const directory = await realpath(await mkdtemp(join(tmpdir(), "alwith-workspace-watch-")))
  const existing = "already-here.txt"
  const added = "created-after-unsubscribe.txt"
  const visible = (name: string) => ui(`!!document.querySelector('[data-file-path$="/${name}"]')`)
  try {
    await writeFile(join(directory, existing), "initial")
    const url = new URL(original)
    url.searchParams.set("html-preview-workspace", directory)
    await rpc("navigate", { window: "main", url: url.href })
    const toggle = 'button[aria-label="打开工作区"]'
    await waitFor(
      () => ui(`!!document.querySelector(${JSON.stringify(toggle)})`).catch(() => false),
      "Workspace toolbar did not load"
    )
    await rpc("click", { window: "main", selector: toggle })
    await waitFor(() => visible(existing), "Workspace did not display the initial file")

    const root = await ipc("plugin:alwith-fs|workspace_open", { path: directory })
    const subscriptionId = crypto.randomUUID()
    await ipc("plugin:alwith-fs|workspace_watch", { root, subscriptionId, enabled: true })
    await ipc("plugin:alwith-fs|workspace_watch", { root, subscriptionId, enabled: false })
    await writeFile(join(directory, added), "updated")
    await waitFor(() => visible(added), "Closing the second watch stopped live updates in the file tree")
  } finally {
    try {
      await rpc("navigate", { window: "main", url: original })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
})
