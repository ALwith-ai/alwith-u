import { appendFileSync, chmodSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { enterpriseGitCredential } from "./lib/enterprise-git-auth"

const token = process.env.ENTERPRISE_GIT_READ_TOKEN ?? ""
if (process.argv[2] === "--askpass") {
  const credential = enterpriseGitCredential(process.argv[3] ?? "", token)
  if (credential === undefined) process.exit(1)
  process.stdout.write(`${credential}\n`)
} else {
  if (!token || /\s/.test(token))
    throw new Error("Configure ENTERPRISE_GIT_READ_TOKEN with read_repository access to the enterprise source project")
  const environment = process.env.GITHUB_ENV
  const directory = process.env.RUNNER_TEMP
  if (!environment || !directory) throw new Error("Enterprise Git authentication setup belongs to GitHub Actions")
  const helper = join(directory, "alwith-enterprise-git-askpass.sh")
  const quote = (value: string) => `'${value.replaceAll("\\", "/").replaceAll("'", "'\\''")}'`
  writeFileSync(helper, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(import.meta.path)} --askpass "$@"\n`, {
    mode: 0o700
  })
  chmodSync(helper, 0o700)
  appendFileSync(environment, `ENTERPRISE_GIT_READ_TOKEN=${token}\nGIT_ASKPASS=${helper}\nGIT_TERMINAL_PROMPT=0\n`)
  console.log("Configured Git read access for the enterprise source host")
}
