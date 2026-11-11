import { resolve } from "node:path"

import { stageDocs } from "./lib/docs-artifact"

await stageDocs(resolve(import.meta.dirname, ".."))
