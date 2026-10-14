import { GamepadWindow } from "@/features/gamepad/gamepad-window"
import { bootstrapAuxWindow } from "@/lib/aux-window-bootstrap"

import { registerGamepadLocales } from "@/lib/i18n"

bootstrapAuxWindow({
  component: GamepadWindow,
  logTag: "gamepad",
  toaster: true,
  setup: async () => registerGamepadLocales()
})
