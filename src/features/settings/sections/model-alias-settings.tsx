import { ChevronDownIcon } from "lucide-react"
import { useId, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { saveModelAlias, useModelAliases } from "@/lib/model-aliases"
import { type CustomProvider, gatewayModelId } from "@/lib/providers"

export function ModelAliasSettings({ providers }: { providers: CustomProvider[] }) {
  const { t } = useTranslation()
  const aliases = useModelAliases()
  if (!providers.some((provider) => provider.models.length)) return null
  return (
    <Collapsible>
      <CollapsibleTrigger render={<Button variant="ghost" size="sm" />}>
        {t("provider.managed.aliases")}
        <ChevronDownIcon className="size-4" />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 pt-3">
        <p className="text-xs text-muted-foreground">{t("provider.managed.aliasHint")}</p>
        {providers.flatMap((provider) =>
          provider.models.map((model) => {
            const id = gatewayModelId(provider.id, model.api_id)
            return <AliasRow key={id} id={id} label={model.label} modelId={model.api_id} alias={aliases[id] ?? ""} />
          })
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

function AliasRow({ id, label, modelId, alias }: { id: string; label: string; modelId: string; alias: string }) {
  const { t } = useTranslation()
  const inputId = useId()
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const value = draft ?? alias
  async function save(): Promise<void> {
    setBusy(true)
    try {
      await saveModelAlias(id, value)
      setDraft(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form
      className="space-y-1.5"
      onSubmit={(event) => {
        event.preventDefault()
        if (!busy) void save()
      }}
    >
      <label htmlFor={inputId} className="text-sm font-medium">
        {label}
      </label>
      <p className="text-xs break-all text-muted-foreground">{modelId}</p>
      <div className="flex items-center gap-2">
        <Input
          id={inputId}
          value={value}
          placeholder={label}
          maxLength={100}
          disabled={busy}
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button type="submit" variant="outline" size="sm" disabled={busy || value.trim() === alias}>
          {t("provider.managed.saveAlias")}
        </Button>
      </div>
    </form>
  )
}
