import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { registerRelease, releaseArtifacts, releaseVersion } from "../release-artifacts"

const directories: string[] = []
const names = [
  "macos_aarch64.dmg",
  "macos_aarch64.app.tar.gz",
  "windows_x64-setup.exe",
  "windows_arm64-setup.exe",
  "windows_arm64.msi"
]

function fixture(): string {
  const directory = mkdtempSync(join(tmpdir(), "alwith-u-release-test-"))
  directories.push(directory)
  for (const name of names) {
    writeFileSync(join(directory, `alwith-u_26.9.24_${name}`), "binary")
    writeFileSync(join(directory, `alwith-u_26.9.24_${name}.sig`), "signed\n")
  }
  writeFileSync(join(directory, "latest.json"), "{}")
  return directory
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true })
})

test("maps installers and signed updater packages to the admin contract and public TOS URLs", () => {
  const artifacts = releaseArtifacts(fixture(), "v26.9.24")
  expect(artifacts).toHaveLength(5)
  expect(artifacts.find(artifact => artifact.format === "dmg")).toMatchObject({
    target: "darwin",
    arch: "darwin-aarch64",
    signature_text: "",
    label: "Apple Silicon"
  })
  expect(artifacts.find(artifact => artifact.format === "tar.gz")).toMatchObject({
    download_url: "https://static.alwith.ai/alwith-u/release/v26.9.24/alwith-u_26.9.24_macos_aarch64.app.tar.gz",
    signature_text: "signed"
  })
  expect(
    artifacts
      .filter(artifact => artifact.format === "nsis")
      .map(artifact => artifact.arch)
      .sort()
  ).toEqual(["windows-aarch64", "windows-x86_64"])
  expect(artifacts.find(artifact => artifact.format === "msi")).toMatchObject({
    arch: "windows-aarch64",
    signature_text: "signed"
  })
})

test("rejects invalid versions, mismatched assets and incomplete platform sets", () => {
  for (const tag of ["26.9.24", "v26.09.24", "v26.9.24/../x", "vv26.9.24"]) {
    expect(() => releaseVersion(tag)).toThrow()
  }
  expect(() => releaseArtifacts(fixture(), "v26.9.25")).toThrow("version")
  const directory = mkdtempSync(join(tmpdir(), "alwith-u-release-test-"))
  directories.push(directory)
  expect(() => releaseArtifacts(directory, "v26.9.24")).toThrow("Missing updater artifact")
})

test("validates all signatures before sending any request", async () => {
  const directory = fixture()
  writeFileSync(join(directory, "alwith-u_26.9.24_windows_x64-setup.exe.sig"), "\n")
  let calls = 0
  const request = Object.assign(
    async (): Promise<Response> => {
      calls++
      return new Response("{}", { status: 201 })
    },
    { preconnect: fetch.preconnect }
  )
  await expect(
    registerRelease(directory, "v26.9.24", "https://api.alwith.ai/management", "test-token", request)
  ).rejects.toThrow("signature")
  expect(calls).toBe(0)
})

test("posts authenticated JSON to the version endpoint and stops on HTTP failures", async () => {
  const directory = fixture()
  let calls = 0
  const request: typeof fetch = Object.assign(
    async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      calls++
      expect(String(url)).toBe(
        "https://api.alwith.ai/management/ci/open-source/releases/alwith-u/26.9.24/artifacts/by-url"
      )
      expect(init?.method).toBe("POST")
      expect(init?.headers).toEqual({ "X-CI-Token": "test-token", "Content-Type": "application/json" })
      expect(JSON.parse(String(init?.body)).download_url).toContain("/alwith-u/release/v26.9.24/")
      expect(init?.redirect).toBe("error")
      return new Response("{}", { status: calls > 5 ? 401 : 201 })
    },
    { preconnect: fetch.preconnect }
  )
  expect(await registerRelease(directory, "v26.9.24", "https://api.alwith.ai/management/", "test-token", request)).toBe(
    5
  )
  await expect(registerRelease(directory, "v26.9.24", "https://api.alwith.ai", "test-token", request)).rejects.toThrow(
    "HTTP 401"
  )
  expect(calls).toBe(6)
})
