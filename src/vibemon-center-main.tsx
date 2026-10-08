import { VibemonCenter } from "@/features/vibemon/pet-center"
import { bootstrapVibemonWindow } from "@/features/vibemon/bootstrap"
import { bootstrapAuxWindow } from "@/lib/aux-window-bootstrap"
bootstrapAuxWindow({ component: VibemonCenter, logTag: "vibemon-center", toaster: true, setup: bootstrapVibemonWindow })
