import type { ProjectContext } from "@nyssance/codex-acp-v2/client"

export function projectContext(homeDirectory = "/Users/mac"): ProjectContext {
  return {
    homeDirectory,
    codexChatDirectory: `${homeDirectory}/Documents/Codex`,
    chatDirectory: `${homeDirectory}/Documents/ALwith`,
    projects: []
  }
}
