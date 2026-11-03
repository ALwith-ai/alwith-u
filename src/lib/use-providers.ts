import { useProviders as useSnapshot } from "@alwith/module-chat/settings"
import { toast } from "sonner"

import { providersPort } from "./providers"
import { text } from "./text"

const reportError = (error: unknown) => toast.error(text(error))

export function useProviders() {
  return useSnapshot(providersPort, reportError)
}
