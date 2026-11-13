import { expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { notifyRelease } from "../release-notification"

function fixture(): string {
  const directory = mkdtempSync(join(tmpdir(), "release-notification-"))
  for (const name of ["darwin_aarch64.dmg", "darwin_aarch64.app.tar.gz", "windows_x64-setup.exe"]) {
    const path = join(directory, `alwith-u_1.2.3_${name}`)
    writeFileSync(path, "binary")
    writeFileSync(`${path}.sig`, "signature")
  }
  return directory
}

test("sends a draft notification containing only actual installer URLs", async () => {
  const directory = fixture()
  try {
    let body: { msg_type: string } | undefined
    const request = Object.assign(
      async (_url: string | URL | Request, init?: RequestInit) => {
        body = JSON.parse(String(init?.body))
        return new Response('{"code":0,"msg":"success"}')
      },
      { preconnect: fetch.preconnect }
    )
    await notifyRelease(directory, "v1.2.3", "https://example.com/webhook", request)
    expect(body?.msg_type).toBe("interactive")
    expect(JSON.stringify(body)).toContain("待发布")
    expect(JSON.stringify(body)).toContain("alwith-u_1.2.3_darwin_aarch64.dmg")
    expect(JSON.stringify(body)).toContain("alwith-u_1.2.3_windows_x64-setup.exe")
    expect(JSON.stringify(body)).not.toContain("app.tar.gz")
    expect(JSON.stringify(body)).not.toContain("Intel")
  } finally {
    rmSync(directory, { recursive: true })
  }
})

test("reports HTTP and Feishu business failures", async () => {
  const directory = fixture()
  try {
    for (const response of [
      new Response("failure", { status: 500 }),
      new Response('{"code":19022,"msg":"Ip Not Allowed"}'),
      new Response("{}")
    ]) {
      const request = Object.assign(async () => response, { preconnect: fetch.preconnect })
      await expect(notifyRelease(directory, "v1.2.3", "https://example.com/webhook", request)).rejects.toThrow()
    }
    await expect(notifyRelease(directory, "v1.2.3", "")).rejects.toThrow("LARK_ROBOT_URL")
  } finally {
    rmSync(directory, { recursive: true })
  }
})
