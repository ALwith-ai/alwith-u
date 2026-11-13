import type { Session } from "@alwith/module-chat/client"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { useStore } from "zustand"

import { Button } from "@/components/ui/button"
import { client } from "@/lib/client"
import { gatewayModelId, providerGroups } from "@/lib/providers"
import { useProviders } from "@/lib/use-providers"

import { DraftModelSelect } from "./draft-model-select"

export function ModelRecovery({ session }: { session: Session }) {
  const { t } = useTranslation()
  const snapshot = useProviders()
  const [busy, setBusy] = useState(false)
  const [model, setModel] = useState<string | null>(null)
  const nativeModels = useStore(client.store, (state) => state.nativeModels)
  const available =
    model !== null &&
    (nativeModels.some((entry) => entry.id === model) ||
      (snapshot !== null &&
        providerGroups(snapshot).some((group) =>
          group.models.some((entry) => gatewayModelId(group.id, entry.id) === model)
        )))
  async function recover(selected: string): Promise<void> {
    setModel(selected)
    setBusy(true)
    try {
      await client.resumeModel(session.id, selected)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2 text-sm text-muted-foreground" aria-busy={busy}>
      <span>{t("provider.managed.reselect")}</span>
      <fieldset disabled={busy}>
        <DraftModelSelect snapshot={snapshot} model={model} onChange={setModel} nativeModels={nativeModels} />
      </fieldset>
      <Button
        size="sm"
        disabled={busy || !available}
        onClick={() => {
          if (model !== null) void recover(model)
        }}
      >
        {t("provider.managed.resume")}
      </Button>
    </div>
  )
}
