// Model providers, reduced from ALwith Desktop's API tab: one row per provider (logo, name,
// status), an API key field with a get-key link, and a region select where the provider has
// several endpoints. A saved key puts the provider's models into every chat's model picker;
// each chat picks its own model. Nothing global is written.
import { ExternalLinkIcon, EyeIcon, EyeOffIcon } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { openExternal } from "@/lib/open"
import { useProviders } from "@/lib/use-providers"
import type { ProviderKey, ProviderInput } from "@/lib/providers"
import { PROVIDERS, type Provider, providerKeyUrl, providerRegion, saveProviderKey } from "@/lib/providers"
import { SettingGroup, SettingLabel } from "./shared"
import { CodexProviderSection } from "./codex-provider-section"

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function ProviderSection() {
  const { t } = useTranslation()
  const snapshot = useProviders()
  const keys = snapshot?.providers ?? {}
  const [busy, setBusy] = useState<string | null>(null)

  const save = async (provider: Provider, key: ProviderInput | null) => {
    if (!snapshot) return
    setBusy(provider.id)
    try {
      const result = await saveProviderKey(snapshot.revision, provider.id, key)
      if (result.error) toast.error(result.error)
      if (!result.error)
        toast.success(
          t(result.status === "pending" ? "provider.pending" : key === null ? "provider.removed" : "provider.saved", {
            name: provider.name
          })
        )
    } catch (error) {
      toast.error(describe(error))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <CodexProviderSection />
      {snapshot?.status === "pending" && <p className="text-muted-foreground text-sm">{t("provider.pending")}</p>}
      {snapshot?.error && <p className="text-destructive text-sm">{snapshot.error}</p>}
      <SettingGroup>
        <SettingLabel>{t("provider.label")}</SettingLabel>
        {PROVIDERS.map((provider, index) => (
          <div key={provider.id}>
            {index > 0 && <Separator />}
            <ProviderRow
              provider={provider}
              saved={keys[provider.id] ?? null}
              busy={busy !== null || snapshot === null}
              onSave={key => void save(provider, key)}
            />
          </div>
        ))}
      </SettingGroup>
    </div>
  )
}

function ProviderRow({
  provider,
  saved,
  busy,
  onSave
}: {
  provider: Provider
  saved: ProviderKey | null
  busy: boolean
  onSave: (key: ProviderInput | null) => void
}) {
  const { t } = useTranslation()
  const [apiKey, setApiKey] = useState("")
  const [showKey, setShowKey] = useState(false)
  const [region, setRegion] = useState(saved?.region ?? provider.regions?.[0]?.id)
  const Logo = provider.logo
  const configured = saved !== null
  const keyTrimmed = apiKey.trim()
  const keyUrl = providerKeyUrl(provider, region)
  const regionChanged =
    configured && provider.regions !== undefined && region !== providerRegion(provider, saved.region)?.id
  const canSave = !busy && (keyTrimmed !== "" || regionChanged)
  const inputId = `${provider.id}-api-key`

  const submit = () => {
    if (keyTrimmed === "" && saved === null) return
    onSave({ ...(keyTrimmed === "" ? {} : { apiKey: keyTrimmed }), ...(region === undefined ? {} : { region }) })
    setApiKey("")
  }

  return (
    <div className="flex flex-col gap-3 py-3">
      <div className="flex items-center gap-3">
        <Logo className="size-6 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm">{provider.name}</div>
          <div className="text-muted-foreground mt-0.5 text-xs">
            {configured
              ? t("provider.active", { name: provider.name, count: provider.models.length })
              : t("provider.inactive")}
          </div>
        </div>
        {provider.regions && (
          <Select value={region} onValueChange={value => setRegion(value ?? provider.regions?.[0]?.id)}>
            <SelectTrigger className="w-32" aria-label={t("provider.region")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {provider.regions.map(entry => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {t(`provider.regions.${entry.id}`)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        )}
      </div>
      <Field>
        <FieldLabel htmlFor={inputId}>{t("provider.apiKey")}</FieldLabel>
        <InputGroup>
          <InputGroupInput
            id={inputId}
            type={showKey ? "text" : "password"}
            autoComplete="off"
            spellCheck={false}
            placeholder={configured ? t("provider.apiKeyKept") : t("provider.apiKeyPlaceholder")}
            value={apiKey}
            onChange={event => setApiKey(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Enter" && canSave) submit()
            }}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              aria-label={t(showKey ? "provider.hideKey" : "provider.showKey")}
              onClick={() => setShowKey(value => !value)}>
              {showKey ? <EyeIcon /> : <EyeOffIcon />}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        {keyUrl !== null && (
          <FieldDescription>
            <button
              type="button"
              className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
              onClick={() => void openExternal(keyUrl)}>
              {t("provider.getKey", { name: provider.name })}
              <ExternalLinkIcon className="size-3" aria-hidden="true" />
            </button>
          </FieldDescription>
        )}
      </Field>
      <div className="flex items-center justify-end gap-2">
        {configured && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onSave(null)}>
            {t("provider.remove")}
          </Button>
        )}
        <Button size="sm" disabled={!canSave} onClick={submit}>
          {busy && <Spinner data-icon="inline-start" />}
          {t("provider.saveButton")}
        </Button>
      </div>
    </div>
  )
}
