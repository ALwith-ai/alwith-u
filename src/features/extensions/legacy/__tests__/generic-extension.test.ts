import { type ExtensionManifest, extensionApiVersion } from "@alwith/module-extension"
import { createCommonJsEvaluator, ExtensionHost, ResourceScope } from "@alwith/module-extension/host"
import * as legacy from "@alwith/module-extension/legacy"
import { createMemoryData } from "@alwith/module-extension/testing"
import { expect, test } from "vitest"
import { createLegacyBridge } from "../bridge"
import { convertLegacyExtension } from "../import"

test("an unlisted legacy application loads modules, mounts a page, and shares file and SDK configuration", async () => {
  const manifest: ExtensionManifest = {
    manifestVersion: 3,
    id: "generic-reader",
    name: "Reader",
    version: "1.0.0",
    entry: "main.js",
    dependencies: { "@alwith/module-extension": "^0.1.4" },
    hosts: { "alwith-u": ">=0.1.1" },
    dataSchemaVersion: 1
  }
  const calls: string[] = []
  const scope = new ResourceScope()
  const bridge = createLegacyBridge(manifest.id, {
    binding: { manifest, cancellation: scope.cancellation, own: dispose => scope.own(dispose) },
    native: async <T>(command: string): Promise<T> => {
      calls.push(command)
      if (command === "legacy_take_initial_data") return { title: "Imported" } as T
      if (command === "legacy_ack_initial_data") return null as T
      throw new Error(`Unexpected native IO: ${command}`)
    },
    session: () => null,
    send: async () => {},
    check: () => {},
    openView: () => {},
    notify: () => ({ hide() {}, setMessage() {} }),
    language: () => "en",
    openExternal: async () => {},
    clipboard: async () => {},
    own: dispose => dispose,
    primary: true
  })
  const host = new ExtensionHost({
    apiVersion: extensionApiVersion,
    host: { id: "alwith-u", version: "0.1.1" },
    capabilities: { "legacy.host": { version: "1.0.0", value: bridge } },
    contributions: { surfaces: "1.0.0", topBar: "1.0.0", commands: "1.0.0", settingsPages: "1.0.0" }
  })
  const prepared = await convertLegacyExtension({
    ticket: "fixture",
    manifest: { id: manifest.id, name: manifest.name, version: manifest.version, minAppVersion: "26.6.18" },
    convertedManifest: { ...manifest },
    styles: "",
    modules: { "defaults.json": '{"title":"Updated"}' },
    source: `const {Plugin,ItemView}=require('@alwith/extension');
      const defaults=require('./defaults.json');
      class Reader extends ItemView {
        getViewType(){return 'reader'}
        async onOpen(){const cfg=await this.plugin.loadData();this.contentEl.createDiv({text:cfg.title});
          this.contentEl.createEl('img',{attr:{src:this.app.vault.adapter.getResourcePath('assets/cover.jpg')}})}
      }
      module.exports=class extends Plugin {
        async onload(){
          const before=await this.loadData();if(before.title!=='Imported')throw new Error('migration missing');
          await window.__TAURI_INTERNALS__.invoke('plugin:fs|write_text_file',new TextEncoder().encode(JSON.stringify(defaults)),{headers:{path:encodeURIComponent(this.manifest.dir+'/data.json')}});
          this.registerView('reader',leaf=>{const view=new Reader(leaf);view.plugin=this;return view});
          this.addRibbonIcon('book-open','Read',async()=>{await this.app.workspace.revealView('reader')});
        }
      };`
  })
  const data = createMemoryData()
  const evaluate = createCommonJsEvaluator({ "@alwith/module-extension/legacy": legacy })
  try {
    await host.activate(manifest, "fixture", evaluate(prepared.main), {
      data,
      resource: path => `https://assets.invalid/${path}`
    })
    expect(host.snapshot().actions[0]).toMatchObject({ icon: "book-open", alignment: "left" })
    expect((await data.read())?.value).toEqual({ title: "Updated" })
    const container = document.createElement("div")
    const release = await host.mount("generic-reader/workspace", container)
    expect(container.textContent).toContain("Updated")
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://assets.invalid/assets/cover.jpg")
    expect(calls).toEqual(["legacy_take_initial_data", "legacy_ack_initial_data"])
    await release()
  } finally {
    await host.dispose()
    await scope.dispose()
  }
  expect(host.snapshot().actions).toHaveLength(0)
})
