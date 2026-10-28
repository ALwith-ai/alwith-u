// Model providers, reduced from ALwith Desktop's API tab: compact provider pills choose one
// configuration panel. A saved key puts that provider's models into every chat's model picker;
// each chat picks its own model. Nothing global is written.
import { CardSendIcon } from "@solar-icons/react/line-duotone/card-send"
import { ChevronDownIcon, ExternalLinkIcon, EyeIcon, EyeOffIcon, PlusIcon, ServerIcon } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/alwith-ui/select"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { openPlatformTopUp } from "@/features/auth/open-account"
import { requestAccountProviderRefresh } from "@/features/auth/store"
import { openExternal } from "@/lib/open"
import type {
  CustomProvider,
  CustomProviderInput,
  ProviderInput,
  ProviderKey,
  ProviderSnapshot,
  ProviderTestResult
} from "@/lib/providers"
import {
  applyProvidersWhenIdle,
  parseCustomModels,
  type Provider,
  providerKeyUrl,
  providerRegion,
  PROVIDERS,
  removeCustomProvider,
  saveCustomProvider,
  saveProviderKey,
  testProvider
} from "@/lib/providers"
import { useProviders } from "@/lib/use-providers"
import { cn } from "@/lib/utils"

import { CodexProviderSection } from "./codex-provider-section"
import { SettingGroup, SettingLabel } from "./shared"

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function ProviderSection() {
  const { t } = useTranslation()
  const snapshot = useProviders()
  const keys = snapshot?.providers ?? {}
  const [busy, setBusy] = useState<string | null>(null)
  const [activeId, setActiveId] = useState(PROVIDERS[0]?.id ?? "")
  const [customDraftVersion, setCustomDraftVersion] = useState(0)
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
        setTestResults((current) => {
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
      setTestResults((current) => ({ ...current, [providerId]: result }))
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
        setTestResults((current) => {
          const next = { ...current }
          delete next[input.id]
          return next
        })
        toast.success(t(result.status === "pending" ? "provider.pending" : "provider.saved", { name: input.name }))
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
        toast.success(t(result.status === "pending" ? "provider.pending" : "provider.removed", { name: provider.name }))
      }
    } catch (error) {
      toast.error(describe(error))
    } finally {
      setBusy(null)
    }
  }

  const retry = async (): Promise<void> => {
    setBusy("retry")
    try {
      const result = await applyProvidersWhenIdle()
      if (result.error) toast.error(result.error)
      else if (result.status === "pending") toast.info(t("provider.pending"))
    } catch (error) {
      toast.error(describe(error))
    } finally {
      setBusy(null)
    }
  }

  const activeBuiltIn = PROVIDERS.find((provider) => provider.id === activeId) ?? null
  const activeCustom = snapshot?.customProviders.find((provider) => provider.id === activeId) ?? null

  useEffect(() => {
    if (!snapshot || activeId === "new" || activeBuiltIn || activeCustom) return
    setActiveId(PROVIDERS[0]?.id ?? "")
  }, [snapshot, activeId, activeBuiltIn, activeCustom])

  return (
    <div className="flex flex-col gap-6">
      <CodexProviderSection />
      <SettingGroup>
        <div className="space-y-3 rounded-xl border p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium">ALwith</h3>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-primary hover:text-primary/80"
              aria-label={t("provider.managed.topUp")}
              title={t("provider.managed.topUp")}
              onClick={() => {
                void openPlatformTopUp().catch((error: unknown) => toast.error(describe(error)))
              }}
            >
              <CardSendIcon className="size-4" aria-hidden="true" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t("provider.managed.description")}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void requestAccountProviderRefresh().catch((error: unknown) => toast.error(describe(error)))
            }}
          >
            {t("provider.managed.refresh")}
          </Button>
        </div>
      </SettingGroup>
      {snapshot?.status === "pending" && <p className="text-sm text-muted-foreground">{t("provider.pending")}</p>}
      {snapshot?.error && <p className="text-sm text-destructive">{snapshot.error}</p>}
      {snapshot && snapshot.status !== "applied" && (
        <Button variant="outline" className="self-start" disabled={busy !== null} onClick={() => void retry()}>
          {t("actions.retry")}
        </Button>
      )}
      <SettingGroup>
        {snapshot && (
          <>
            <ProviderTabs
              activeId={activeId}
              keys={keys}
              customProviders={snapshot.customProviders}
              onSelect={setActiveId}
              onAdd={() => setActiveId("new")}
            />
            {PROVIDERS.map((provider) => (
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
            {snapshot.customProviders.map((provider) => (
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
                key={customDraftVersion}
                provider={null}
                revision={snapshot.revision}
                busy={busy !== null}
                onSaved={(id) => {
                  setCustomDraftVersion((version) => version + 1)
                  setActiveId(id)
                }}
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
    <div>
      <SettingLabel>{t("provider.label")}</SettingLabel>
      <div className="grid grid-cols-2 gap-2 py-4 sm:grid-cols-3">
        {PROVIDERS.map((provider) => {
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
        {customProviders.map((provider) => (
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
          className={cn("h-9 w-full justify-start gap-2 rounded-full px-4", activeId === "new" && "bg-accent")}
        >
          <PlusIcon className="size-4 shrink-0" />
          <span className="truncate">{t("provider.customButton")}</span>
        </Button>
      </div>
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
      className={cn("h-9 w-full gap-2 rounded-full px-4", active && "bg-accent")}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate text-center">{name}</span>
      <span
        data-testid={`${id}-status`}
        data-configured={configured}
        aria-hidden="true"
        className={cn("size-2 shrink-0 rounded-full", configured ? "bg-success" : "bg-muted-foreground/30")}
      />
    </Button>
  )
}

function TestFeedback({ result }: { result: ProviderTestResult }) {
  const { t } = useTranslation()
  return (
    <p role="status" className={result.ok ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>
      {result.ok
        ? t("provider.testSuccess", { latency: result.latencyMs ?? 0 })
        : `${t(`provider.testErrors.${result.code}`)}${result.status ? ` (HTTP ${result.status})` : ""}`}
    </p>
  )
}

function ProviderActions({
  busy,
  canTest,
  onTest,
  onRemove,
  result,
  children
}: {
  busy: boolean
  canTest: boolean
  onTest?: () => void
  onRemove?: () => void
  result?: ProviderTestResult
  children: ReactNode
}): ReactNode {
  const { t } = useTranslation()
  return (
    <div className="space-y-3 border-t pt-4">
      {result && <TestFeedback result={result} />}
      {onTest && <p className="text-xs leading-relaxed text-muted-foreground">{t("provider.testDescription")}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {onRemove && (
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            disabled={busy}
            onClick={onRemove}
          >
            {t("provider.remove")}
          </Button>
        )}
        <div className="ms-auto flex flex-wrap items-center gap-2">
          {onTest && (
            <Button size="sm" variant="outline" disabled={busy || !canTest} onClick={onTest}>
              {t("provider.testButton")}
            </Button>
          )}
          {children}
        </div>
      </div>
    </div>
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
  const [baseUrl, setBaseUrl] = useState(saved?.base_url ?? "")
  const Logo = provider.logo
  const configured = saved !== null
  const keyTrimmed = apiKey.trim()
  const keyUrl = providerKeyUrl(provider, region)
  const regionChanged = region !== providerRegion(provider, base.saved?.region)?.id
  const baseUrlChanged = baseUrl.trim() !== (base.saved?.base_url ?? "")
  useEffect(() => {
    if (revision > base.revision && keyTrimmed === "" && !regionChanged && !baseUrlChanged) {
      setBase({ saved, revision })
      setRegion(providerRegion(provider, saved?.region)?.id)
      setBaseUrl(saved?.base_url ?? "")
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
    setApiKey((current) => (current === submittedKey ? "" : current))
    setRegion((current) => (current === submittedRegion ? providerRegion(provider, nextSaved?.region)?.id : current))
    setBaseUrl((current) => (current === baseUrl ? (nextSaved?.base_url ?? "") : current))
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
    <div className="space-y-5 rounded-xl border p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Logo className="size-6 shrink-0" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium">{provider.name}</h3>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {configured
              ? t("provider.active", { name: provider.name, count: provider.models.length })
              : t("provider.inactive")}
          </div>
        </div>
        {provider.regions && (
          <Select value={region} onValueChange={(value) => setRegion(value ?? provider.regions?.[0]?.id)}>
            <SelectTrigger className="w-32" aria-label={t("provider.region")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {provider.regions.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {t(`provider.regions.${entry.id}`)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        )}
      </div>
      <Separator />
      <section className="space-y-4" aria-labelledby={`${provider.id}-connection`}>
        <h4 id={`${provider.id}-connection`} className="text-sm font-medium">
          {t("provider.connectionSettings")}
        </h4>
        <Field className="gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <FieldLabel htmlFor={inputId}>{t("provider.apiKey")}</FieldLabel>
            {keyUrl !== null && (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs text-muted-foreground"
                onClick={() => void openExternal(keyUrl).catch((error: unknown) => toast.error(describe(error)))}
              >
                {t("provider.getKey", { name: provider.name })}
                <ExternalLinkIcon className="size-3" aria-hidden="true" />
              </Button>
            )}
          </div>
          <InputGroup>
            <InputGroupInput
              id={inputId}
              type={showKey ? "text" : "password"}
              autoComplete="off"
              spellCheck={false}
              placeholder={configured ? t("provider.apiKeyKept") : t("provider.apiKeyPlaceholder")}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && canSave) submit()
              }}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                aria-label={t(showKey ? "provider.hideKey" : "provider.showKey")}
                onClick={() => setShowKey((value) => !value)}
              >
                {showKey ? <EyeIcon /> : <EyeOffIcon />}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </Field>
        <Collapsible className="space-y-2">
          <CollapsibleTrigger render={<Button variant="ghost" size="sm" className="group px-2.5" />}>
            {t("provider.baseUrl")}
            <ChevronDownIcon
              className="size-4 transition-transform group-aria-expanded:rotate-180"
              aria-hidden="true"
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Field className="gap-2">
              <FieldLabel htmlFor={`${provider.id}-base-url`} className="sr-only">
                {t("provider.baseUrl")}
              </FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id={`${provider.id}-base-url`}
                  type="url"
                  spellCheck={false}
                  placeholder={providerRegion(provider, region)?.baseUrl ?? provider.baseUrl}
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                />
              </InputGroup>
              <FieldDescription className="text-xs">{t("provider.baseUrlDescription")}</FieldDescription>
            </Field>
          </CollapsibleContent>
        </Collapsible>
      </section>
      <ProviderActions
        busy={busy}
        canTest={!canSave}
        onTest={configured ? onTest : undefined}
        onRemove={configured ? () => void persist(null) : undefined}
        result={!canSave ? testResult : undefined}
      >
        <Button size="sm" disabled={!canSave} onClick={submit}>
          {busy && <Spinner data-icon="inline-start" />}
          {t("provider.saveButton")}
        </Button>
      </ProviderActions>
    </div>
  )
}

export function CustomProviderEditor({
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
  const [showKey, setShowKey] = useState(false)
  const [modelsOpen, setModelsOpen] = useState(provider === null)
  const [previewModels, setPreviewModels] = useState(provider?.models ?? [])
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
    name.trim() !== provider?.name ||
    baseUrl.trim() !== provider.baseUrl ||
    apiKey.trim() !== "" ||
    modelsJson !== JSON.stringify(provider.models, null, 2)

  const changeModelsOpen = (open: boolean): void => {
    if (!open) {
      try {
        setPreviewModels(parseCustomModels(modelsJson))
        setModelsError(null)
      } catch (error) {
        setModelsError(describe(error))
        return
      }
    }
    setModelsOpen(open)
  }

  const submit = async () => {
    let models: CustomProvider["models"]
    try {
      models = parseCustomModels(modelsJson)
      setModelsError(null)
    } catch (error) {
      setModelsError(describe(error))
      setModelsOpen(true)
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
    <div className="space-y-5 rounded-xl border p-4">
      <div className="flex items-center gap-3">
        <ServerIcon className="size-6 shrink-0" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium break-words">{provider?.name || t("provider.addCustom")}</h3>
          <div className="mt-0.5 text-xs text-muted-foreground">{t("provider.customDescription")}</div>
        </div>
        {provider && <span className="shrink-0 text-xs text-muted-foreground">{t("provider.configured")}</span>}
      </div>
      <Separator />
      <section className="space-y-4" aria-labelledby={`${id}-connection`}>
        <h4 id={`${id}-connection`} className="text-sm font-medium">
          {t("provider.connectionSettings")}
        </h4>
        <Field className="gap-2">
          <FieldLabel htmlFor={nameInputId}>{t("provider.name")}</FieldLabel>
          <Input id={nameInputId} value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field className="gap-2">
          <FieldLabel htmlFor={urlInputId}>{t("provider.baseUrl")}</FieldLabel>
          <Input
            id={urlInputId}
            type="url"
            placeholder="https://.../v1"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        </Field>
        <Field className="gap-2">
          <FieldLabel htmlFor={keyInputId}>{t("provider.apiKey")}</FieldLabel>
          <InputGroup>
            <InputGroupInput
              id={keyInputId}
              type={showKey ? "text" : "password"}
              autoComplete="off"
              placeholder={provider ? t("provider.apiKeyKept") : t("provider.apiKeyPlaceholder")}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                aria-label={t(showKey ? "provider.hideKey" : "provider.showKey")}
                onClick={() => setShowKey((value) => !value)}
              >
                {showKey ? <EyeIcon /> : <EyeOffIcon />}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </Field>
      </section>
      <Separator />
      <Collapsible open={modelsOpen} onOpenChange={changeModelsOpen} className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-medium">{t("provider.models")}</h4>
          <CollapsibleTrigger render={<Button variant="ghost" size="sm" />}>
            {t(modelsOpen ? "provider.previewModels" : "provider.editModels")}
            <ChevronDownIcon className={cn("size-4", modelsOpen && "rotate-180")} />
          </CollapsibleTrigger>
        </div>
        {!modelsOpen && (
          <ul className="divide-y rounded-lg bg-muted/40 px-3">
            {previewModels.map((model) => (
              <li
                key={model.api_id}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5 text-sm"
              >
                <span className="break-all">{model.label}</span>
                <span className="font-mono text-xs break-all text-muted-foreground">{model.api_id}</span>
              </li>
            ))}
          </ul>
        )}
        <CollapsibleContent>
          <Field className="gap-2" data-invalid={modelsError !== null}>
            <FieldLabel htmlFor={modelsInputId}>{t("provider.modelsJson")}</FieldLabel>
            <Textarea
              id={modelsInputId}
              aria-invalid={modelsError !== null}
              aria-describedby={`${modelsInputId}-description`}
              spellCheck={false}
              className="min-h-44 font-mono text-xs"
              value={modelsJson}
              onChange={(event) => {
                setModelsJson(event.target.value)
                setModelsError(null)
              }}
            />
            <FieldDescription
              id={`${modelsInputId}-description`}
              className={cn("text-xs", modelsError && "text-destructive")}
              role={modelsError ? "alert" : undefined}
            >
              {modelsError ?? t("provider.modelsJsonDescription")}
            </FieldDescription>
          </Field>
        </CollapsibleContent>
      </Collapsible>
      <ProviderActions
        busy={busy}
        canTest={!dirty}
        onTest={provider ? onTest : undefined}
        onRemove={provider ? onRemove : undefined}
        result={!dirty ? testResult : undefined}
      >
        <Button
          size="sm"
          disabled={
            busy || !dirty || name.trim() === "" || baseUrl.trim() === "" || (!provider && apiKey.trim() === "")
          }
          onClick={() => void submit()}
        >
          {busy && <Spinner data-icon="inline-start" />}
          {t("provider.saveButton")}
        </Button>
      </ProviderActions>
    </div>
  )
}
