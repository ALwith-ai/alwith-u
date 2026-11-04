import { expect, test } from "bun:test"

import { enterpriseGitCredential } from "../enterprise-git-auth"

test("enterprise Git credentials are scoped to the exact source host", () => {
  const token = "fake-ci-read-token"
  expect(enterpriseGitCredential("Username for 'https://ai-gitlab.finture.id': ", token)).toBe("oauth2")
  expect(enterpriseGitCredential("Password for 'https://oauth2@ai-gitlab.finture.id': ", token)).toBe(token)
  for (const prompt of [
    "Password for 'https://github.com': ",
    "Password for 'https://oauth2@ai-gitlab.finture.id.evil.example': ",
    "Password for 'http://oauth2@ai-gitlab.finture.id': "
  ]) {
    expect(enterpriseGitCredential(prompt, token)).toBeUndefined()
  }
  expect(enterpriseGitCredential("Password for 'https://oauth2@ai-gitlab.finture.id': ", "")).toBeUndefined()
})
