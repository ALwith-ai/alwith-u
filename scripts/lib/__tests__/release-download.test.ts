import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const root = resolve(import.meta.dirname, "../../..")
const workflow = Bun.YAML.parse(readFileSync(join(root, ".github/workflows/release.yml"), "utf8")) as {
  jobs: Record<string, { steps: Array<{ name?: string; run?: string }> }>
}
const script = workflow.jobs["upload-to-tos"].steps.find((step) => step.name === "Download release assets")!.run!

// Exercise the workflow's real shell with an offline GitHub API fixture.
const mock = `
gh() {
  case "$*" in
    'api --paginate repos/test/repo/releases')
      printf '%s\n' '[{"id":1,"tag_name":"v0.2.14"},{"id":2,"tag_name":"v0.2.14"}]' '[{"id":3,"tag_name":"v0.2.14"},{"id":4,"tag_name":"v0.2.13"}]' ;;
    'api --paginate repos/test/repo/releases/1/assets')
      printf '%s\n' '[{"id":11,"name":"mac.app.tar.gz"},{"id":12,"name":"mac.app.tar.gz.sig"},{"id":13,"name":"latest.json"}]' ;;
    'api --paginate repos/test/repo/releases/2/assets')
      if [ "$SCENARIO" = api-error ]; then return 1; fi
      printf '%s\n' '[{"id":21,"name":"x64-setup.exe"},{"id":22,"name":"x64-setup.exe.sig"}]' ;;
    'api --paginate repos/test/repo/releases/3/assets')
      if [ "$SCENARIO" = distinct ]; then
        printf '%s\n' '[{"id":31,"name":"arm64-setup.exe"}]'
      else
        printf '%s\n' '[{"id":31,"name":"x64-setup.exe"}]'
      fi ;;
    'api -H Accept: application/octet-stream repos/test/repo/releases/assets/'*)
      if [[ "$*" == */31 && "$SCENARIO" = conflict ]]; then
        printf different
      else
        printf binary
      fi ;;
    *) echo "Unexpected API request: $*" >&2; return 1 ;;
  esac
}
`

function download(scenario: string, releaseId = "") {
  const directory = mkdtempSync(join(tmpdir(), "release-download-"))
  try {
    const result = Bun.spawnSync(["bash", "-c", mock + script], {
      env: {
        ...process.env,
        RUNNER_TEMP: directory,
        GITHUB_REPOSITORY: "test/repo",
        RELEASE_TAG: "v0.2.14",
        RELEASE_ID: releaseId,
        SCENARIO: scenario
      }
    })
    return {
      code: result.exitCode,
      error: result.stderr.toString(),
      files: readdirSync(join(directory, "tos-release")).sort()
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test("manual recovery downloads all matching drafts across pages and filters metadata", () => {
  const result = download("distinct")
  expect(result.code).toBe(0)
  expect(result.files).toEqual([
    "arm64-setup.exe",
    "mac.app.tar.gz",
    "mac.app.tar.gz.sig",
    "x64-setup.exe",
    "x64-setup.exe.sig"
  ])
})

test("tag builds download only the explicit shared release", () => {
  const result = download("distinct", "2")
  expect(result.code).toBe(0)
  expect(result.files).toEqual(["x64-setup.exe", "x64-setup.exe.sig"])
})

test("identical duplicates are accepted but conflicting bytes stop recovery", () => {
  expect(download("identical").code).toBe(0)
  const result = download("conflict")
  expect(result.code).not.toBe(0)
  expect(result.error).toContain("Conflicting assets across releases: x64-setup.exe")
})

test("asset enumeration failures stop recovery", () => {
  expect(download("api-error").code).not.toBe(0)
})
