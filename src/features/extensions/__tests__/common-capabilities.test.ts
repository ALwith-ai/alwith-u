import { expect, test } from "bun:test"
import {
  binaryHttpCapability,
  clipboardCapability,
  directoriesCapability,
  extensionApiVersion,
  filesCapability,
  noticesCapability,
  type DirectoryHandle,
  type ExtensionManifest,
  type FilesCapability,
  type NoticeHandle
} from "@alwith/module-extension"
import { createCommonCapabilities, ExtensionHost, type NativeFileRequest } from "@alwith/module-extension/host"
import { createMemoryData } from "@alwith/module-extension/testing"

test("the installed package exposes common capabilities to a modern extension and revokes retained handles", async () => {
  const calls: { command: string; args: Record<string, unknown> }[] = []
  const copied: string[] = []
  const messages: string[] = []
  const providers = createCommonCapabilities({
    async native<T>(command: string, args: Record<string, unknown>): Promise<T> {
      calls.push({ command, args })
      if (command === "extension_pick_directory") return { scope: "grant", path: "/private/selected" } as T
      if (command === "extension_http")
        return { status: 200, url: "https://api.github.com/data", headers: {}, body: [0, 128, 255] } as T
      if (command === "extension_file") {
        const request = args.request as NativeFileRequest
        if (request.operation === "read") return { type: "read", body: [0, 128, 255] } as T
        if (request.operation === "write") return { type: "ok" } as T
      }
      throw new Error(`Unexpected native command: ${command}`)
    },
    clipboard: {
      async writeText(text): Promise<void> {
        copied.push(text)
      }
    },
    notices: {
      show(message) {
        messages.push(message)
        return {
          hide() {
            messages.length = 0
          },
          setMessage(text) {
            messages[0] = text
          }
        }
      }
    }
  })
  const manifest: ExtensionManifest = {
    manifestVersion: 3,
    id: "common-demo",
    name: "Demo",
    version: "1.0.0",
    entry: "main.js",
    dependencies: { "@alwith/module-extension": "^0.1.5" },
    hosts: {},
    dataSchemaVersion: 1
  }
  const host = new ExtensionHost({ apiVersion: extensionApiVersion, capabilities: { ...providers }, contributions: {} })
  let files!: FilesCapability
  let directory!: DirectoryHandle
  let notice!: NoticeHandle
  try {
    await host.activate(
      manifest,
      "fixture",
      context => ({
        async onload() {
          files = context.capability(filesCapability)
          const selected = await context.capability(directoriesCapability).pick()
          if (!selected) throw new Error("Expected a selected directory")
          directory = selected
          const response = await context
            .capability(binaryHttpCapability)
            .request({ url: "https://api.github.com/data" })
          await directory.files.write("result.bin", response.body)
          await context.capability(clipboardCapability).writeText("result.bin")
          notice = context.capability(noticesCapability).show("Saved", 0)
        }
      }),
      {
        data: createMemoryData(),
        resource: () => {
          throw new Error("No bundled resource expected")
        }
      }
    )
    expect(directory.id).toBe("grant")
    expect(directory.name).toBe("selected")
    expect(Object.keys(directory).sort()).toEqual(["files", "id", "name"])
    expect(calls.find(call => call.command === "extension_file")?.args).toEqual({
      extensionId: manifest.id,
      request: { operation: "write", scope: "grant", path: "result.bin", body: [0, 128, 255] }
    })
    expect(Array.from(await files.read("result.bin"))).toEqual([0, 128, 255])
    await expect(files.write("./DATA.JSON", new Uint8Array())).rejects.toThrow("context.data")
    expect(copied).toEqual(["result.bin"])
    expect(messages).toEqual(["Saved"])
  } finally {
    await host.dispose()
  }
  expect(messages).toEqual([])
  notice.setMessage("late")
  expect(messages).toEqual([])
  await expect(directory.files.read("result.bin")).rejects.toThrow("revoked")
})
