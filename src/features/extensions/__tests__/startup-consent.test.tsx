import { extensionApiVersion, type ExtensionManifest } from "@alwith/module-extension"
import { ExtensionHost } from "@alwith/module-extension/host"
import { createLegacyExtension } from "@alwith/module-extension/legacy"
import { createMemoryData } from "@alwith/module-extension/testing"
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks"
import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, beforeEach, expect, test } from "vitest"

import { initI18n } from "@/lib/i18n"

import { connectExtensionNavigation } from "../chat/navigation"
import { ExtensionViewContent } from "../extension-view"
import { createLegacyHost } from "../legacy/host"

let disconnectNavigation: () => void

beforeEach(async () => {
  await initI18n("zh-CN")
  mockWindows("main")
  mockIPC(() => null)
  disconnectNavigation = connectExtensionNavigation({
    currentSession: () => null,
    openView: () => {},
    send: async () => {},
    setDraft: async () => {}
  })
})
afterEach(() => {
  cleanup()
  disconnectNavigation()
  clearMocks()
})

async function fixture(consented?: true | "declined", id = "yup-kb", delayed = false) {
  const manifest: ExtensionManifest = {
    manifestVersion: 3,
    id,
    name: "Knowledge",
    version: "1.0.0",
    entry: "main.js",
    dependencies: { "@alwith/module-extension": "^0.1.0-rc.11" },
    hosts: {},
    dataSchemaVersion: 1
  }
  const provider = createLegacyHost(() => ({
    id,
    installationId: "fixture",
    enabled: true,
    packageRevision: "one",
    dataGeneration: 1,
    source: "legacy:alwith-u",
    manifest
  }))
  const host = new ExtensionHost({
    apiVersion: extensionApiVersion,
    capabilities: { "legacy.host": provider },
    contributions: { surfaces: "1.0.0", commands: "1.0.0", settingsPages: "1.0.0", statusBar: "1.0.0" }
  })
  const data = createMemoryData()
  const initial = { _sessionsSync: {} as { consented?: true | "declined" } }
  if (consented !== undefined) initial._sessionsSync.consented = consented
  await data.write(initial, null, 1)
  await host.activate(
    manifest,
    "one",
    context => {
      context.view("statusBar", { id: "status", title: "Status", mount: () => () => {} })
      return createLegacyExtension(context, {
        manifest,
        source: `const obs=require('@alwith/extension');
      class Page extends obs.ItemView {
        getViewType(){return 'knowledge'}
        onOpen(){this.contentEl.textContent='Knowledge page'}
      }
      class Settings extends obs.PluginSettingTab {
        display(){new obs.Setting(this.containerEl).addButton(b=>b.setButtonText('Enable archive').onClick(async()=>{
          await this.plugin.saveData({_sessionsSync:{consented:true}});
        }))}
      }
      module.exports=class extends obs.Plugin {
        async onload(){
          this.registerView('knowledge',leaf=>new Page(leaf));
          this.addSettingTab(new Settings(this.app,this));
          this.addCommand({id:'info',name:'Info',callback:()=>{
            const modal=new obs.Modal(this.app);modal.setTitle('Information');modal.open();
          }});
          const prompt=async()=>{
          const data=await this.loadData();
          if(data._sessionsSync.consented)return;
          const modal=new obs.Modal(this.app);modal.titleEl.textContent='启用 AI 对话归档同步？';
          const enable=modal.contentEl.createEl('button',{text:'同意并启用'});
          enable.onclick=async()=>{await this.saveData({_sessionsSync:{consented:true}});await modal.close()};
          const decline=modal.contentEl.createEl('button',{text:'暂不启用'});
          decline.onclick=async()=>{await this.saveData({_sessionsSync:{consented:'declined'}});await modal.close()};
          modal.open();
          };
          this.addCommand({id:'prompt',name:'Prompt',callback:prompt});
          ${delayed ? "" : "await prompt();"}
        }
      };`
      })
    },
    { data, resource: path => `https://assets.invalid/${path}` }
  )
  return { host, data, initial }
}

test.each(["同意并启用", "暂不启用"])("startup defers consent until the extension page opens: %s", async label => {
  const { host, data, initial } = await fixture()
  try {
    expect(document.querySelector("[role=dialog]")).toBeNull()
    expect((await data.read())?.value).toEqual(initial)
    const errors: unknown[] = []
    const ui = render(<ExtensionViewContent host={host} id="yup-kb/workspace" onError={error => errors.push(error)} />)
    await act(async () => {})
    expect(ui.getByRole("dialog")).toHaveTextContent("启用 AI 对话归档同步？")
    await act(async () => fireEvent.click(ui.getByRole("button", { name: label })))
    expect(ui.queryByRole("dialog")).toBeNull()
    expect((await data.read())?.value).toEqual({
      _sessionsSync: { consented: label === "同意并启用" ? true : "declined" }
    })
    expect(errors).toEqual([])
    ui.unmount()
    await host.dispose()
  } finally {
    await host.dispose()
  }
})

test.each([true, "declined"] as const)(
  "a recorded decision skips the prompt and keeps the settings entry: %s",
  async consented => {
    const { host, data } = await fixture(consented)
    try {
      const ui = render(
        <ExtensionViewContent
          host={host}
          id="yup-kb/settings"
          onError={error => {
            throw error
          }}
        />
      )
      await act(async () => {})
      expect(ui.queryByRole("dialog")).toBeNull()
      await act(async () => fireEvent.click(ui.getByRole("button", { name: "Enable archive" })))
      expect((await data.read())?.value).toEqual({ _sessionsSync: { consented: true } })
      ui.unmount()
    } finally {
      await host.dispose()
    }
  }
)

test("other extensions still display their startup modals", async () => {
  const { host } = await fixture(undefined, "other-reader")
  try {
    expect(document.querySelector("[role=dialog]")).not.toBeNull()
  } finally {
    await host.dispose()
  }
})

test("Yup dialogs other than archive consent still appear before opening its page", async () => {
  const { host } = await fixture()
  try {
    const command = host.snapshot().commands.find(command => command.id === "yup-kb/info")
    if (!command) throw new Error("Missing information command")
    await command.run()
    expect(document.querySelectorAll("[role=dialog]")).toHaveLength(1)
    expect(document.querySelector("[role=dialog]")).toHaveTextContent("Information")
  } finally {
    await host.dispose()
  }
})

test("consent created after the extension page opens is displayed without another navigation", async () => {
  const { host } = await fixture(undefined, "yup-kb", true)
  try {
    const ui = render(
      <ExtensionViewContent
        host={host}
        id="yup-kb/workspace"
        onError={error => {
          throw error
        }}
      />
    )
    await act(async () => {})
    expect(ui.queryByRole("dialog")).toBeNull()
    await act(async () => {
      const command = host.snapshot().commands.find(command => command.id === "yup-kb/prompt")
      if (!command) throw new Error("Missing consent command")
      await command.run()
    })
    expect(ui.getByRole("dialog")).toHaveTextContent("启用 AI 对话归档同步？")
    ui.unmount()
  } finally {
    await host.dispose()
  }
})

test("mounting the startup status bar does not count as opening the extension", async () => {
  const { host } = await fixture()
  try {
    const ui = render(
      <ExtensionViewContent
        host={host}
        id="yup-kb/status"
        onError={error => {
          throw error
        }}
      />
    )
    await act(async () => {})
    expect(ui.queryByRole("dialog")).toBeNull()
    ui.unmount()
  } finally {
    await host.dispose()
  }
})
