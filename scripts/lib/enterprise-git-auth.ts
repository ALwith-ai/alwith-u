/** Return credentials only for the fixed enterprise source host. */
export function enterpriseGitCredential(prompt: string, token: string): string | undefined {
  if (prompt === "Username for 'https://ai-gitlab.finture.id': ") return "oauth2"
  if (prompt === "Password for 'https://oauth2@ai-gitlab.finture.id': ") return token || undefined
  return undefined
}
