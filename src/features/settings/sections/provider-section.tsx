// Model providers, reduced from ALwith Desktop's API tab: compact provider pills choose one
// configuration panel. A saved key puts that provider's models into every chat's model picker;
// each chat picks its own model. Nothing global is written.
import { ExternalLinkIcon, EyeIcon, EyeOffIcon, PlusIcon, ServerIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { openExternal } from "@/lib/open"
import { cn } from "@/lib/utils"
import { useProviders } from "@/lib/use-providers"
import type {
  CustomProvider,
  CustomProviderInput,
  ProviderKey,
  ProviderInput,
  ProviderSnapshot,
  ProviderTestResult
} from "@/lib/providers"
import {
  PROVIDERS,
  type Provider,
  parseCustomModels,
  providerKeyUrl,
  providerRegion,
  removeCustomProvider,
  saveCustomProvider,
  saveProviderKey,
  testProvider
} from "@/lib/providers"
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
  const [activeId, setActiveId] = useState(PROVIDERS[0]?.id ?? "")
  const [testResults, setTestResults] = useState<Record<string, ProviderTestResult>>({})

  const save = async (
    revision: number,
    provider: Provider,
    key: ProviderInput | null
  ): Promise<ProviderSnapshot | null> => {
    setBusy(provider.id)
    try {
      const result = await saveProviderKey(revision, provider.id, key)
      if (!result.error)
        setTestResults(current => {
          const next = { ...current }
          delete next[provider.id]
          return next
        })
      if (result.error) toast.error(result.error)
      if (!result.error)
        toast.success(
          t(result.status === "pending" ? "provider.pending" : key === null ? "provider.removed" : "provider.saved", {
            name: provider.name
          })
        )
      return result
    } catch (error) {
      toast.error(describe(error))
      return null
    } finally {
      setBusy(null)
    }
  }

  const test = async (providerId: string) => {
    setBusy(providerId)
    try {
      const result = await testProvider(providerId)
      setTestResults(current => ({ ...current, [providerId]: result }))
      if (result.ok) toast.success(t("provider.testSuccess", { latency: result.latencyMs ?? 0 }))
      else toast.error(`${t(`provider.testErrors.${result.code}`)}${result.message ? `: ${result.message}` : ""}`)
    } catch (error) {
      toast.error(describe(error))
    } finally {
      setBusy(null)
    }
  }

  const saveCustom = async (revision: number, input: CustomProviderInput): Promise<boolean> => {
    setBusy(input.id)
    try {
      const result = await saveCustomProvider(revision, input)
      if (result.error) toast.error(result.error)
      else {
        setTestResults(current => {
          const next = { ...current }
          delete next[input.id]
          return next
        })
        toast.success(t("provider.saved", { name: input.name }))
      }
      return !result.error
    } catch (error) {
      toast.error(describe(error))
      return false
    } finally {
      setBusy(null)
    }
  }

  const removeCustom = async (provider: CustomProvider) => {
    if (!snapshot) return
    setBusy(provider.id)
    try {
      const result = await removeCustomProvider(snapshot.revision, provider.id)
      if (result.error) toast.error(result.error)
      else {
        setActiveId(PROVIDERS[0]?.id ?? "")
        toast.success(t("provider.removed", { name: provider.name }))
      }
    } catch (error) {
      toast.error(describe(error))
    } finally {
      setBusy(null)
    }
  }

  const activeBuiltIn = PROVIDERS.find(provider => provider.id === activeId) ?? null
  const activeCustom = snapshot?.customProviders.find(provider => provider.id === activeId) ?? null

  useEffect(() => {
    if (!snapshot || activeId === "new" || activeBuiltIn || activeCustom) return
    setActiveId(PROVIDERS[0]?.id ?? "")
  }, [snapshot, activeId, activeBuiltIn, activeCustom])

  return (
    <div className="flex flex-col gap-4">
      <CodexProviderSection />
      {snapshot?.status === "pending" && <p className="text-muted-foreground text-sm">{t("provider.pending")}</p>}
      {snapshot?.error && <p className="text-destructive text-sm">{snapshot.error}</p>}
      <SettingGroup>
        <SettingLabel>{t("provider.label")}</SettingLabel>
        <p className="text-muted-foreground pt-2 text-xs">{t("provider.testDescription")}</p>
        {snapshot && (
          <>
            <ProviderTabs
              activeId={activeId}
              keys={keys}
              customProviders={snapshot.customProviders}
              onSelect={setActiveId}
              onAdd={() => setActiveId("new")}
            />
            <Separator />
            {PROVIDERS.map(provider => (
              <div key={provider.id} hidden={activeId !== provider.id}>
                <ProviderRow
                  provider={provider}
                  saved={keys[provider.id] ?? null}
                  revision={snapshot.revision}
                  busy={busy !== null}
                  onSave={(revision, key) => save(revision, provider, key)}
                  testResult={testResults[provider.id]}
                  onTest={() => test(provider.id)}
                />
              </div>
            ))}
            {snapshot.customProviders.map(provider => (
              <div key={provider.id} hidden={activeId !== provider.id}>
                <CustomProviderEditor
                  provider={provider}
                  revision={snapshot.revision}
                  busy={busy !== null}
                  testResult={testResults[provider.id]}
                  onTest={() => test(provider.id)}
                  onRemove={() => removeCustom(provider)}
                  onSaved={setActiveId}
                  onSave={saveCustom}
                />
              </div>
            ))}
            <div hidden={activeId !== "new"}>
              <CustomProviderEditor
                provider={null}
                revision={snapshot.revision}
                busy={busy !== null}
                onSaved={setActiveId}
                onSave={saveCustom}
              />
            </div>
          </>
        )}
      </SettingGroup>
    </div>
  )
}

export function ProviderTabs({
  activeId,
  keys,
  customProviders,
  onSelect,
  onAdd
}: {
  activeId: string
  keys: Record<string, ProviderKey>
  customProviders: CustomProvider[]
  onSelect: (id: string) => void
  onAdd: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="grid grid-cols-2 gap-2 py-4 sm:grid-cols-3">
      {PROVIDERS.map(provider => {
        const Logo = provider.logo
        const configured = keys[provider.id] !== undefined
        return (
          <ProviderTab
            key={provider.id}
            id={provider.id}
            name={provider.name}
            active={activeId === provider.id}
            configured={configured}
            icon={<Logo className="size-5 shrink-0" />}
            onClick={() => onSelect(provider.id)}
          />
        )
      })}
      {customProviders.map(provider => (
        <ProviderTab
          key={provider.id}
          id={provider.id}
          name={provider.name}
          active={activeId === provider.id}
          configured
          icon={<ServerIcon className="size-5 shrink-0" />}
          onClick={() => onSelect(provider.id)}
        />
      ))}
      <Button
        type="button"
        variant="outline"
        aria-pressed={activeId === "new"}
        onClick={onAdd}
        className={cn("h-9 w-full justify-start gap-2 rounded-full px-4", activeId === "new" && "bg-accent")}>
        <PlusIcon className="size-4 shrink-0" />
        <span className="truncate">{t("provider.addCustom")}</span>
      </Button>
    </div>
  )
}

function ProviderTab({
  id,
  name,
  active,
  configured,
  icon,
  onClick
}: {
  id: string
  name: string
  active: boolean
  configured: boolean
  icon: React.ReactNode
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      variant="outline"
      aria-label={name}
      aria-pressed={active}
      onClick={onClick}
      className={cn("h-9 w-full gap-2 rounded-full px-4", active && "bg-accent")}>
      {icon}
      <span className="min-w-0 flex-1 truncate text-center">{name}</span>
      <span
        data-testid={`${id}-status`}
        data-configured={configured}
        aria-hidden="true"
        className={cn("size-2 shrink-0 rounded-full", configured ? "bg-primary" : "bg-muted-foreground/30")}
      />
    </Button>
  )
}

function TestFeedback({ result }: { result: ProviderTestResult }) {
  const { t } = useTranslation()
  return (
    <p className={result.ok ? "text-muted-foreground mt-1 text-xs" : "text-destructive mt-1 text-xs"}>
      {result.ok
        ? t("provider.testSuccess", { latency: result.latencyMs ?? 0 })
        : `${t(`provider.testErrors.${result.code}`)}${result.status ? ` (HTTP ${result.status})` : ""}`}
    </p>
  )
}

export function ProviderRow({
  provider,
  saved,
  revision,
  busy,
  onSave,
  testResult,
  onTest
}: {
  provider: Provider
  saved: ProviderKey | null
  revision: number
  busy: boolean
  onSave: (revision: number, key: ProviderInput | null) => Promise<ProviderSnapshot | null>
  testResult?: ProviderTestResult
  onTest?: () => void
}) {
  const { t } = useTranslation()
  const [apiKey, setApiKey] = useState("")
  const [showKey, setShowKey] = useState(false)
  const [base, setBase] = useState({ saved, revision })
  const [region, setRegion] = useState(providerRegion(provider, saved?.region)?.id)
  const [baseUrl, setBaseUrl] = useState(saved?.baseUrl ?? "")
  const Logo = provider.logo
  const configured = saved !== null
  const keyTrimmed = apiKey.trim()
  const keyUrl = providerKeyUrl(provider, region)
  const regionChanged = region !== providerRegion(provider, base.saved?.region)?.id
  const baseUrlChanged = baseUrl.trim() !== (base.saved?.baseUrl ?? "")
  useEffect(() => {
    if (revision > base.revision && keyTrimmed === "" && !regionChanged && !baseUrlChanged) {
      setBase({ saved, revision })
      setRegion(providerRegion(provider, saved?.region)?.id)
      setBaseUrl(saved?.baseUrl ?? "")
    }
  }, [revision, saved, provider, base.revision, keyTrimmed, regionChanged, baseUrlChanged])
  const canSave = !busy && (keyTrimmed !== "" || regionChanged || baseUrlChanged)
  const inputId = `${provider.id}-api-key`

  const persist = async (input: ProviderInput | null) => {
    const submittedKey = apiKey,
      submittedRegion = region
    const result = await onSave(base.revision, input)
    if (!result) return
    const nextSaved = result.providers[provider.id] ?? null
    setBase({ saved: nextSaved, revision: result.revision })
    setApiKey(current => (current === submittedKey ? "" : current))
    setRegion(current => (current === submittedRegion ? providerRegion(provider, nextSaved?.region)?.id : current))
    setBaseUrl(current => (current === baseUrl ? (nextSaved?.baseUrl ?? "") : current))
  }
  const submit = () => {
    if (keyTrimmed === "" && base.saved === null) return
    void persist({
      ...(keyTrimmed === "" ? {} : { apiKey: keyTrimmed }),
      ...(region === undefined ? {} : { region }),
      ...(baseUrlChanged ? { baseUrl: baseUrl.trim() } : {})
    })
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
      <Field>
        <FieldLabel htmlFor={`${provider.id}-base-url`}>{t("provider.baseUrl")}</FieldLabel>
        <InputGroup>
          <InputGroupInput
            id={`${provider.id}-base-url`}
            type="url"
            spellCheck={false}
            placeholder={providerRegion(provider, region)?.baseUrl ?? provider.baseUrl}
            value={baseUrl}
            onChange={event => setBaseUrl(event.target.value)}
          />
        </InputGroup>
        <FieldDescription>{t("provider.baseUrlDescription")}</FieldDescription>
      </Field>
      <div className="flex items-center justify-end gap-2">
        {testResult && !canSave && <TestFeedback result={testResult} />}
        {configured && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void persist(null)}>
            {t("provider.remove")}
          </Button>
        )}
        {configured && onTest && (
          <Button size="sm" variant="outline" disabled={busy || canSave} onClick={onTest}>
            {t("provider.testButton")}
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

function CustomProviderEditor({
  provider,
  revision,
  busy,
  testResult,
  onTest,
  onRemove,
  onSaved,
  onSave
}: {
  provider: CustomProvider | null
  revision: number
  busy: boolean
  testResult?: ProviderTestResult
  onTest?: () => void
  onRemove?: () => void
  onSaved: (id: string) => void
  onSave: (revision: number, input: CustomProviderInput) => Promise<boolean>
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(provider?.name ?? "")
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? "")
  const [apiKey, setApiKey] = useState("")
  const [modelsJson, setModelsJson] = useState(
    provider ? JSON.stringify(provider.models, null, 2) : '[\n  { "label": "My Model", "api_id": "model-id" }\n]'
  )
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [id] = useState(() => provider?.id ?? `custom_${crypto.randomUUID().replaceAll("-", "")}`)
  const nameInputId = `${id}-name`
  const urlInputId = `${id}-base-url`
  const keyInputId = `${id}-api-key`
  const modelsInputId = `${id}-models`
  const dirty =
    provider === null ||
    name.trim() !== provider.name ||
    baseUrl.trim() !== provider.baseUrl ||
    apiKey.trim() !== "" ||
    modelsJson !== JSON.stringify(provider.models, null, 2)

  const submit = async () => {
    let models: CustomProvider["models"]
    try {
      models = parseCustomModels(modelsJson)
      setModelsError(null)
    } catch (error) {
      setModelsError(describe(error))
      return
    }
    const saved = await onSave(revision, {
      id,
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      models,
      ...(apiKey.trim() === "" ? {} : { apiKey: apiKey.trim() })
    })
    if (saved) onSaved(id)
  }

  return (
    <div className="flex flex-col gap-5 py-4">
      <div className="flex items-center gap-3">
        <ServerIcon className="size-6 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{provider?.name || t("provider.addCustom")}</div>
          <div className="text-muted-foreground mt-0.5 text-xs">{t("provider.customDescription")}</div>
        </div>
        {provider && onRemove && (
          <Button size="sm" variant="outline" disabled={busy} onClick={onRemove}>
            {t("provider.remove")}
          </Button>
        )}
      </div>
      <div className="grid gap-4">
        <Field>
          <FieldLabel htmlFor={nameInputId}>{t("provider.name")}</FieldLabel>
          <Input id={nameInputId} value={name} onChange={event => setName(event.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor={urlInputId}>{t("provider.baseUrl")}</FieldLabel>
          <Input
            id={urlInputId}
            type="url"
            placeholder="https://.../v1"
            value={baseUrl}
            onChange={event => setBaseUrl(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={keyInputId}>{t("provider.apiKey")}</FieldLabel>
          <Input
            id={keyInputId}
            type="password"
            autoComplete="off"
            placeholder={provider ? t("provider.apiKeyKept") : t("provider.apiKeyPlaceholder")}
            value={apiKey}
            onChange={event => setApiKey(event.target.value)}
          />
        </Field>
        <Field data-invalid={modelsError !== null}>
          <FieldLabel htmlFor={modelsInputId}>{t("provider.modelsJson")}</FieldLabel>
          <Textarea
            id={modelsInputId}
            className="min-h-44 font-mono text-xs"
            value={modelsJson}
            onChange={event => {
              setModelsJson(event.target.value)
              setModelsError(null)
            }}
          />
          <FieldDescription>{modelsError ?? t("provider.modelsJsonDescription")}</FieldDescription>
        </Field>
      </div>
      <div className="flex items-center justify-end gap-2">
        {testResult && !dirty && <TestFeedback result={testResult} />}
        {provider && onTest && (
          <Button variant="outline" disabled={busy || dirty} onClick={onTest}>
            {t("provider.testButton")}
          </Button>
        )}
        <Button
          disabled={
            busy || !dirty || name.trim() === "" || baseUrl.trim() === "" || (!provider && apiKey.trim() === "")
          }
          onClick={() => void submit()}>
          {busy && <Spinner data-icon="inline-start" />}
          {t("provider.saveButton")}
        </Button>
      </div>
    </div>
  )
}
