import { VibemonQuickReply } from "@alwith/module-auth/vibemon/react"

import { bootstrapVibemonWindow } from "@/features/vibemon/bootstrap"
import { bootstrapAuxWindow } from "@/lib/aux-window-bootstrap"

bootstrapAuxWindow({
  component: () => <VibemonQuickReply />,
  logTag: "vibemon-bubble",
  setup: bootstrapVibemonWindow,
  transparent: true
})
