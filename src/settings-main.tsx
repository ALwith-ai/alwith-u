// Entry of the settings window (ALwith Desktop's settings-main).
import { bootstrapAuxWindow } from "@/lib/aux-window-bootstrap"
import { SettingsPage } from "@/features/settings/settings-page"

bootstrapAuxWindow({ component: SettingsPage, logTag: "settings", toaster: true })
