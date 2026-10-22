import { ExternalLink } from "lucide-react"
import type { ReactElement } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { openSettingsWindow } from "@/lib/window-manager"

export function ModelSettingsAction(): ReactElement {
  const { t } = useTranslation()
  const label = t("chat.model.configureModels")
  return (
    <DropdownMenuItem
      className="h-9 gap-2 rounded-md px-2 text-sm font-normal"
      title={label}
      onClick={() => {
        void openSettingsWindow("provider").catch((error: unknown) => {
          toast.error(error instanceof Error ? error.message : String(error))
        })
      }}
    >
      {t("model.moreModels", { ns: "alwithChat" })}
      <ExternalLink className="ml-auto size-4" aria-hidden="true" />
    </DropdownMenuItem>
  )
}
