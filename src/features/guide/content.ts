import { parseGuide } from "@/core/docs"

import metadata from "../../../guide/catalog.json"
import content from "../../../guide/index.md?raw"
import manifest from "../../../package.json"

export const guideChapters = parseGuide(content, metadata)
export const guideVersion = manifest.version
