import type { ProjectContext } from "@alwith/module-chat/client"

export function projectContext(homeDirectory = "/Users/mac"): ProjectContext {
  return {
    homeDirectory,
    codexChatDirectory: `${homeDirectory}/Documents/Codex`,
    chatDirectory: `${homeDirectory}/Documents/ALwith`,
    projects: []
  }
}
