import { PetWindow } from "@alwith/module-auth/pets/react"
import { bootstrapVibemonWindow } from "@/features/vibemon/bootstrap"
import { bootstrapAuxWindow } from "@/lib/aux-window-bootstrap"

bootstrapAuxWindow({ component: PetWindow, logTag: "vibemon", setup: bootstrapVibemonWindow, transparent: true })
