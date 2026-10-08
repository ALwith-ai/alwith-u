import { stageVibemon } from "@alwith/module-vibemon/stage"
import { resolve } from "node:path"
stageVibemon(resolve(import.meta.dirname, "../public"))
