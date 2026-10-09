import { expect, test } from "bun:test"
import { type ExtensionManifest, extensionApiVersion } from "@alwith/module-extension"
import { createCommonJsEvaluator, ExtensionHost, ResourceScope } from "@alwith/module-extension/host"
import * as plugin from "@alwith/module-extension/plugin"
import { createMemoryData } from "@alwith/module-extension/testing"
import { installDom } from "@/features/chat/codex/__tests__/dom-environment"
import { createLegacyBridge } from "../bridge"

installDom()

test("a formal Plugin entry runs on U's common host without a legacy import certificate", async () => {
  const manifest: ExtensionManifest = {
    manifestVersion: 3,
    id: "formal-notes",
    name: "Notes",
    version: "1.0.0",
    entry: "main.js",
    dependencies: { "@alwith/module-extension": "^0.1.8" },
    hosts: { "alwith-u": ">=0.2.0" },
    dataSchemaVersion: 1
  }
  const scope = new ResourceScope()
  const bridge = createLegacyBridge(manifest.id, {
    imported: false,
    binding: { manifest, cancellation: scope.cancellation, own: dispose => scope.own(dispose) },
    native: async (): Promise<never> => {
      throw new Error("Formal Plugin data must use SDK storage")
    },
    session: () => null,
    send: async () => {},
    check: () => scope.cancellation.throwIfAborted(),
    openView: () => {},
    notify: () => ({ hide() {}, setMessage() {} }),
    language: () => "en",
    openExternal: async () => {},
    clipboard: async () => {},
    own: dispose => scope.own(dispose),
    primary: true
  })
  const host = new ExtensionHost({
    apiVersion: extensionApiVersion,
    host: { id: "alwith-u", version: "0.2.0" },
    capabilities: { [plugin.pluginHostCapability.id]: { version: "1.0.0", value: bridge } },
    contributions: { surfaces: "1.0.0", commands: "1.0.0", settingsPages: "1.0.0" }
  })
  const entry = createCommonJsEvaluator({ "@alwith/module-extension/plugin": plugin })(`
    const {createPluginExtension,Plugin,ItemView}=require('@alwith/module-extension/plugin');
    module.exports.default=context=>createPluginExtension(context,{
      manifest:{id:'formal-notes',name:'Notes',version:'1.0.0'},
      create(api,app,manifest){
        class NotesView extends ItemView {
          getViewType(){return 'notes'}
          onOpen(){this.contentEl.textContent='Shared Plugin API'}
        }
        return new class extends Plugin {
          async onload(){await this.saveData({title:'Saved'});this.registerView('notes',leaf=>new NotesView(leaf))}
        }(app,manifest)
      }
    })`)
  const data = createMemoryData()
  try {
    await host.activate(manifest, "fixture", entry, { data, resource: path => `https://assets.invalid/${path}` })
    expect((await data.read())?.value).toEqual({ title: "Saved" })
    const container = document.createElement("div")
    const release = await host.mount("formal-notes/workspace", container)
    expect(container.textContent).toContain("Shared Plugin API")
    await release()
  } finally {
    await host.dispose()
    await scope.dispose()
  }
  expect(host.snapshot().views).toHaveLength(0)
})
