import { GuidePage } from "@/features/guide/guide-page"
import { bootstrapAuxWindow } from "@/lib/aux-window-bootstrap"

bootstrapAuxWindow({ component: GuidePage, logTag: "guide", toaster: true })
