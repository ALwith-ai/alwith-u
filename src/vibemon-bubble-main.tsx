import { PetQuickReply } from "@alwith/module-vibemon/react"
import { bootstrapVibemonWindow } from "@/features/vibemon/bootstrap"
import { bootstrapAuxWindow } from "@/lib/aux-window-bootstrap"
bootstrapAuxWindow({
  component: () => <PetQuickReply />,
  logTag: "vibemon-bubble",
  setup: bootstrapVibemonWindow,
  transparent: true
})
