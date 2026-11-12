import { imageModel, type ImageSelection } from "@alwith/module-chat/image"

import type { SessionInputConfig } from "../input-config"
import { imageApplicationContext } from "./image-context"

export const imageInputMode = {
  persistConfig: true,
  nativeTools: { imageGeneration: false },
  applicationContext: imageApplicationContext,
  parseConfig(config: SessionInputConfig["config"]): ImageSelection {
    if (
      typeof config.model !== "string" ||
      typeof config.size !== "string" ||
      Object.keys(config).some((key) => key !== "model" && key !== "size")
    )
      throw new Error("Invalid image input config")
    const selection = { model: config.model, size: config.size } as ImageSelection
    imageModel(selection)
    return selection
  },
  routePrompt<T>(routes: { image: () => T }): T {
    return routes.image()
  }
}
