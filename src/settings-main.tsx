// Entry of the settings window (ALwith Desktop's settings-main).

import { SettingsPage } from "@/features/settings/settings-page"
import { bootstrapAuxWindow } from "@/lib/aux-window-bootstrap"

bootstrapAuxWindow({ component: SettingsPage, logTag: "settings", toaster: true })
