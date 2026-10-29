import type { Session } from "@nyssance/codex-acp-v2/client"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { client } from "@/lib/client"
import { useProviders } from "@/lib/use-providers"

import { DraftModelSelect } from "./draft-model-select"

export function AccountModelRecovery({ session }: { session: Session }) {
  const { t } = useTranslation()
  const snapshot = useProviders()
  const [busy, setBusy] = useState(false)
  const [model, setModel] = useState<string | null>(null)
  async function recover(selected: string | null): Promise<void> {
    setModel(selected)
    setBusy(true)
    try {
      await client.resumeAccountModel(session.id, selected)
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
        <DraftModelSelect snapshot={snapshot} model={model} onChange={setModel} />
      </fieldset>
      <Button size="sm" disabled={busy} onClick={() => void recover(model)}>
        {t("provider.managed.resume")}
      </Button>
    </div>
  )
}
