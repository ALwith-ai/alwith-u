import { emit, listen } from "@tauri-apps/api/event"
import { ExternalLinkIcon, EyeIcon, EyeOffIcon } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { commands, type ImageSettings } from "@/bindings"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { ImageModelIcon } from "@/features/images/model-icon"
import { selectableImageModels } from "@/features/images/preferences"
import { IMAGE_PROVIDERS_CHANGED } from "@/features/images/provider-events"
import { openExternal } from "@/lib/open"
import type { ProviderTestResult } from "@/lib/providers"

import { ProviderActions, type ProviderOperation } from "./provider-actions"
import { ProviderBaseUrl, ProviderConnectionSettings } from "./provider-connection-settings"
import { ProviderTab } from "./provider-tab"
import { useProviderTestFeedback } from "./provider-test-feedback"
import { SettingGroup, SettingLabel, SettingRow } from "./shared"

const minimaxRegions = {
  cn: {
    baseUrl: "https://api.minimax.cn/v1",
    keyUrl: "https://platform.minimax.cn/user-center/basic-information/interface-key"
  },
  intl: {
    baseUrl: "https://api.minimax.io/v1",
    keyUrl: "https://platform.minimax.io/user-center/basic-information/interface-key"
  }
} as const

type ExternalImageProvider = "seedream" | "minimax"

export function ImageSection({ onOpenModels }: { onOpenModels: () => void }) {
  const { t } = useTranslation()
  const [activeProvider, setActiveProvider] = useState<ExternalImageProvider>("seedream")
  const [busyProvider, setBusyProvider] = useState<ExternalImageProvider | null>(null)
  const [configured, setConfigured] = useState({ seedream: false, minimax: false })
  const updateConfigured = useCallback((provider: ExternalImageProvider, value: boolean) => {
    setConfigured((current) => (current[provider] === value ? current : { ...current, [provider]: value }))
  }, [])
  return (
    <>
      <SettingGroup>
        <SettingRow title="ChatGPT Images" desc={t("images.chatgptAuth")}>
          <Button variant="outline" size="sm" onClick={onOpenModels}>
            {t("images.manageAccount")}
          </Button>
        </SettingRow>
      </SettingGroup>
      <SettingGroup>
        <SettingLabel>{t("images.otherModels")}</SettingLabel>
        <div className="grid grid-cols-2 gap-2 py-4 sm:grid-cols-3">
          {(["seedream", "minimax"] as const).map((provider) => (
            <ProviderTab
              key={provider}
              id={`image-${provider}`}
              name={provider === "seedream" ? "Seedream" : "MiniMax"}
              active={activeProvider === provider}
              configured={configured[provider]}
              icon={<ImageModelIcon provider={provider} />}
              onClick={() => setActiveProvider(provider)}
            />
          ))}
        </div>
        {(["seedream", "minimax"] as const).map((provider) => (
          <div key={provider} hidden={activeProvider !== provider}>
            <ImageProviderSettings
              provider={provider}
              configured={configured[provider]}
              onConfigured={updateConfigured}
              busy={busyProvider !== null}
              onBusy={setBusyProvider}
            />
          </div>
        ))}
      </SettingGroup>
    </>
  )
}

function ImageProviderSettings({
  provider,
  configured,
  onConfigured,
  busy,
  onBusy
}: {
  provider: ExternalImageProvider
  configured: boolean
  busy: boolean
  onBusy: (provider: ExternalImageProvider | null) => void
  onConfigured: (provider: ExternalImageProvider, configured: boolean) => void
}) {
  const { t } = useTranslation()
  const testFeedback = useProviderTestFeedback()
  const [key, setKey] = useState("")
  const [baseUrl, setBaseUrl] = useState("")
  const [region, setRegion] = useState<"cn" | "intl">("cn")
  const [showKey, setShowKey] = useState(false)
  const [settings, setSettings] = useState<ImageSettings | null>(null)
  const [operation, setOperation] = useState<ProviderOperation>()
  const [testResult, setTestResult] = useState<ProviderTestResult>()
  const [readAttempt, setReadAttempt] = useState(0)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (settings) onConfigured(provider, settings.configured)
  }, [provider, settings, onConfigured])
  const dirty = useRef(false)
  const pending = useRef(false)
  const mounted = useRef(false)
  const reads = useRef(0)
  const readRevision = useRef<number | null>(null)
  const regionChanged = provider === "minimax" && settings !== null && region !== settings.region
  dirty.current = key.trim() !== "" || (settings !== null && baseUrl !== settings.baseUrl) || regionChanged
  const canSave =
    settings !== null &&
    !busy &&
    (settings.configured || key.trim() !== "") &&
    (key.trim() !== "" || baseUrl.trim() !== settings.baseUrl || regionChanged)
  useEffect(() => {
    mounted.current = true
    const read = () => {
      const request = ++reads.current
      void commands.imagesReadSettings({ provider }).then(
        (value) => {
          if (!mounted.current || request !== reads.current || pending.current) return
          if (readRevision.current !== value.revision) setTestResult(undefined)
          readRevision.current = value.revision
          onConfigured(provider, value.configured)
          if (dirty.current) return
          setSettings(value)
          setBaseUrl(value.baseUrl)
          setRegion(value.region ?? "cn")
          setError(null)
        },
        (cause: unknown) => {
          if (mounted.current && request === reads.current && !pending.current) setError(String(cause))
        }
      )
    }
    read()
    window.addEventListener("focus", read)
    const stop = listen(IMAGE_PROVIDERS_CHANGED, read)
    void stop.catch((cause: unknown) => toast.error(String(cause)))
    return () => {
      mounted.current = false
      window.removeEventListener("focus", read)
      void stop.then(
        (unlisten) => unlisten(),
        () => undefined
      )
    }
  }, [provider, onConfigured, readAttempt])
  const testConnection = async () => {
    if (!settings?.configured || dirty.current || pending.current || busy) return
    pending.current = true
    ++reads.current
    onBusy(provider)
    setOperation("test")
    setTestResult(undefined)
    try {
      const result = await commands.imagesTestKey({ provider })
      if (mounted.current) {
        setTestResult(result)
        testFeedback.result(result)
      }
    } catch (cause: unknown) {
      if (mounted.current) testFeedback.error(cause)
    } finally {
      pending.current = false
      onBusy(null)
      if (mounted.current) setOperation(undefined)
    }
  }
  const save = async (removeKey = false) => {
    if (!settings || pending.current || busy) return
    pending.current = true
    ++reads.current
    setTestResult(undefined)
    onBusy(provider)
    setOperation(removeKey ? "remove" : "save")
    setError(null)
    try {
      const next = await commands.imagesSaveSettings({
        input: {
          provider,
          ...(provider === "minimax" ? { region: removeKey ? "cn" : region } : {}),
          baseUrl: removeKey ? "" : baseUrl.trim(),
          apiKey: removeKey ? "" : key.trim() || null,
          expectedRevision: settings.revision
        }
      })
      void emit(IMAGE_PROVIDERS_CHANGED).catch((cause: unknown) => toast.error(String(cause)))
      if (!mounted.current) return
      setSettings(next)
      setBaseUrl(next.baseUrl)
      setRegion(next.region ?? "cn")
      setKey("")
      setShowKey(false)
      toast.success(t(removeKey ? "images.keyRemoved" : "images.settingsSaved"))
    } catch (cause: unknown) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
      // A different provider or window may have advanced the shared settings revision.
      // Keep the draft and require another explicit save against the refreshed snapshot.
      try {
        const current = await commands.imagesReadSettings({ provider })
        if (mounted.current) setSettings(current)
      } catch {
        // Preserve the original save error when the settings service is also unavailable.
      }
    } finally {
      pending.current = false
      onBusy(null)
      if (mounted.current) setOperation(undefined)
    }
  }
  return (
    <form
      aria-label={provider === "seedream" ? "Seedream" : "MiniMax"}
      className="space-y-5 rounded-xl border p-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (canSave) void save()
      }}
    >
      <div className="flex flex-wrap items-center gap-3">
        <ImageModelIcon provider={provider} className="size-6 shrink-0" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium">{provider === "seedream" ? "Seedream" : "MiniMax"}</h3>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {configured
              ? t("provider.active", {
                  count: selectableImageModels.filter((model) => model.provider === provider).length
                })
              : t("provider.inactive")}
          </div>
        </div>
        {provider === "minimax" && (
          <Select
            value={region}
            disabled={settings === null || busy}
            onValueChange={(value) => {
              if (value !== "cn" && value !== "intl") throw new Error("Unknown MiniMax region")
              dirty.current = true
              setRegion(value)
              setBaseUrl("")
            }}
          >
            <SelectTrigger className="w-32" aria-label={t("provider.region")}>
              <SelectValue>{t(`provider.regions.${region}`)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {(["cn", "intl"] as const).map((id) => (
                  <SelectItem key={id} value={id}>
                    {t(`provider.regions.${id}`)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        )}
      </div>
      <ProviderConnectionSettings id={`${provider}-connection`}>
        <Field className="gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <FieldLabel htmlFor={`${provider}-api-key`}>{t("provider.apiKey")}</FieldLabel>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs text-muted-foreground"
              onClick={() =>
                void openExternal(
                  provider === "seedream"
                    ? "https://ark.volcengine.com/region:cn-beijing/apikey"
                    : minimaxRegions[region].keyUrl
                ).catch((cause: unknown) => toast.error(cause instanceof Error ? cause.message : String(cause)))
              }
            >
              {t("provider.getKey", { name: provider === "seedream" ? "Seedream" : "MiniMax" })}
              <ExternalLinkIcon className="size-3" aria-hidden="true" />
            </Button>
          </div>
          <InputGroup>
            <InputGroupInput
              id={`${provider}-api-key`}
              type={showKey ? "text" : "password"}
              autoComplete="off"
              spellCheck={false}
              aria-label={t(provider === "seedream" ? "images.seedreamKey" : "images.minimaxKey")}
              value={key}
              disabled={settings === null || busy}
              onChange={(event) => {
                dirty.current = true
                setKey(event.target.value)
              }}
              placeholder={settings?.configured ? t("provider.apiKeyKept") : t("provider.apiKeyPlaceholder")}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  if (canSave) void save()
                }
              }}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                type="button"
                size="icon-xs"
                disabled={settings === null || busy}
                aria-label={t(showKey ? "provider.hideKey" : "provider.showKey")}
                onClick={() => setShowKey((value) => !value)}
              >
                {showKey ? <EyeIcon /> : <EyeOffIcon />}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </Field>
        <ProviderBaseUrl
          id={`${provider}-base-url`}
          value={baseUrl}
          disabled={settings === null || busy}
          placeholder={provider === "minimax" ? minimaxRegions[region].baseUrl : settings?.defaultBaseUrl}
          onChange={(value) => {
            dirty.current = true
            setBaseUrl(value)
          }}
          description={t(provider === "seedream" ? "images.baseUrlHint" : "images.minimaxBaseUrlHint")}
        />
      </ProviderConnectionSettings>
      <ProviderActions
        busy={busy}
        operation={operation}
        canTest={!dirty.current}
        onTest={settings?.configured ? () => void testConnection() : undefined}
        onRemove={settings?.configured ? () => void save(true) : undefined}
        result={dirty.current ? undefined : testResult}
        testDescription={t("images.testDescription")}
      >
        <Button type="submit" size="sm" disabled={!canSave} aria-busy={operation === "save"}>
          {operation === "save" && <Spinner data-icon="inline-start" aria-hidden="true" />}
          {t("provider.saveButton")}
        </Button>
      </ProviderActions>
      {error && (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
          {settings === null && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => setReadAttempt((value) => value + 1)}
            >
              {t("actions.retry")}
            </Button>
          )}
        </div>
      )}
    </form>
  )
}
