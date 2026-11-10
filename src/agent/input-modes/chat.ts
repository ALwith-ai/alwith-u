import type { SessionInputConfig } from "../input-config"
import { imageApplicationContext } from "./image-context"

/** Codex owns chat model settings; the default input mode needs no extra persisted config. */
export const chatInputMode = {
  persistConfig: false,
  tools: undefined,
  nativeTools: {},
  applicationContext: () => imageApplicationContext(null),
  parseConfig(config: SessionInputConfig["config"]): Record<string, never> {
    if (Object.keys(config).length) throw new Error("Chat input config must be empty")
    return {}
  },
  routePrompt<T>(routes: { native: () => T }): T {
    return routes.native()
  }
}
