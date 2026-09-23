import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const root = resolve(import.meta.dirname, "../../..")

type Step = {
  name?: string
  uses?: string
  run?: string
  with?: Record<string, unknown>
}

type Job = {
  if?: string
  needs?: string
  permissions?: Record<string, string>
  strategy?: { matrix?: { include?: unknown[] } }
  steps?: Step[]
}

type Workflow = { jobs?: Record<string, Job> }

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8")
}

function releaseWorkflow(): Record<string, Job> {
  const parsed = Bun.YAML.parse(read(".github/workflows/release.yml")) as Workflow
  if (!parsed.jobs) throw new Error("release workflow has no jobs")
  return parsed.jobs
}

function tauriStep(job: Job): Step {
  const step = job.steps?.find(candidate => candidate.uses?.startsWith("tauri-apps/tauri-action@"))
  if (!step) throw new Error("job has no tauri-action step")
  return step
}

const releaseTargets = [
  { target: "aarch64-apple-darwin", runner: "macos-15" },
  { target: "x86_64-pc-windows-msvc", runner: "windows-2025" },
  { target: "aarch64-pc-windows-msvc", runner: "windows-11-arm" }
]

test("every CI Bun installation uses the packageManager pin and checks toolchain consistency", () => {
  for (const path of [".github/workflows/ci.yml", ".github/workflows/release.yml"]) {
    const workflow = Bun.YAML.parse(read(path)) as Workflow
    for (const job of Object.values(workflow.jobs!)) {
      const steps = job.steps!
      const setup = steps.find(step => step.uses === "oven-sh/setup-bun@v2")
      expect(setup?.with?.["bun-version-file"]).toBe("package.json")
      expect(steps.some(step => step.run === "bun scripts/check-toolchain.ts")).toBe(true)
    }
  }
})

test("installers include Bun and the Codex executable pair with versioned Bun notices", () => {
  const config = JSON.parse(read("src-tauri/tauri.conf.json")) as {
    bundle: { externalBin: string[]; resources: Record<string, string> }
  }
  for (const binary of ["bun", "codex", "codex-code-mode-host", "codex-acp-v2", "alwith-runtime"]) {
    expect(config.bundle.externalBin).toContain(`binaries/${binary}`)
  }
  expect(config.bundle.resources["resources/licenses"]).toBe("licenses")
  const manifest = JSON.parse(read("package.json")) as { packageManager: string }
  const version = manifest.packageManager.slice("bun@".length)
  expect(read(`src-tauri/resources/licenses/bun-${version}.md`)).toContain(`bun-v${version}/LICENSE.md`)
})

test("manual runs build unsigned macOS and Windows workflow artifacts without creating a release", () => {
  const job = releaseWorkflow()["test-bundles"]

  expect(job).toBeDefined()
  expect(job!.if).toBe("github.event_name == 'workflow_dispatch'")
  expect(job!.permissions).toEqual({ contents: "read" })
  expect(job!.strategy?.matrix?.include).toEqual(releaseTargets)

  const step = tauriStep(job!)
  expect(step.uses).toBe("tauri-apps/tauri-action@v1")
  expect(step.with?.args).toContain("src-tauri/tauri.ci-test.conf.json")
  expect(step.with?.uploadWorkflowArtifacts).toBe(true)
  expect(step.with).not.toHaveProperty("tagName")
  expect(step.with).not.toHaveProperty("releaseName")
})

test("tag runs validate release inputs and publish signed updater artifacts to a draft release", () => {
  const jobs = releaseWorkflow()
  const preflight = jobs["release-preflight"]
  const release = jobs.release

  expect(preflight).toBeDefined()
  expect(preflight!.if).toBe("startsWith(github.ref, 'refs/tags/v')")
  expect(release).toBeDefined()
  expect(release!.if).toBe("startsWith(github.ref, 'refs/tags/v')")
  expect(release!.needs).toBe("release-preflight")
  expect(release!.permissions).toEqual({ contents: "write" })
  expect(release!.strategy?.matrix?.include).toEqual(releaseTargets)

  const step = tauriStep(release!)
  expect(step.uses).toBe("tauri-apps/tauri-action@v1")
  expect(step.with?.tagName).toBe("${{ github.ref_name }}")
  expect(step.with?.releaseName).toBe("ALwith U ${{ github.ref_name }}")
  expect(step.with?.releaseDraft).toBe(true)
  expect(step.with?.updaterJsonPreferNsis).toBe(true)
  expect(step.with?.releaseAssetNamePattern).toBe("alwith-u_[version]_[platform]_[arch][setup][ext]")
})

test("Tauri keeps ASCII technical identifiers while displaying ALwith U", () => {
  const config = JSON.parse(read("src-tauri/tauri.conf.json")) as {
    productName?: string
    mainBinaryName?: string
    identifier?: string
    app?: { windows?: Array<{ title?: string }> }
    bundle?: { publisher?: string }
    plugins?: { updater?: { endpoints?: string[] } }
  }
  const devConfig = JSON.parse(read("src-tauri/tauri.dev-instance.conf.json")) as { productName?: string }

  expect(config.productName).toBe("ALwith U")
  expect(config.mainBinaryName).toBe("alwith-u")
  expect(config.identifier).toBe("ai.alwith.u")
  expect(config.app?.windows?.[0]?.title).toBe("ALwith U")
  expect(config.bundle?.publisher).toBe("alwith.ai")
  expect(config.plugins?.updater?.endpoints).toEqual([
    "https://github.com/ALwith-ai/alwith-u/releases/latest/download/latest.json"
  ])
  expect(devConfig.productName).toBe("ALwith U Dev")
})
