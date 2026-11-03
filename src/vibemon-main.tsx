import { VibemonWindow } from "@alwith/module-auth/vibemon/react"

import { bootstrapVibemonWindow } from "@/features/vibemon/bootstrap"
import { bootstrapAuxWindow } from "@/lib/aux-window-bootstrap"

bootstrapAuxWindow({ component: VibemonWindow, logTag: "vibemon", setup: bootstrapVibemonWindow, transparent: true })
