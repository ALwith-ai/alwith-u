import { emit } from "@tauri-apps/api/event"
import { ExternalLinkIcon, EyeIcon, EyeOffIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { commands, type ImageSettings } from "@/bindings"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Spinner } from "@/components/ui/spinner"
import { ImageModelIcon } from "@/features/images/model-icon"
import { IMAGE_PROVIDERS_CHANGED } from "@/features/images/provider-events"
import { openExternal } from "@/lib/open"

import { ProviderBaseUrl, ProviderConnectionSettings } from "./provider-connection-settings"
import { SettingGroup, SettingLabel, SettingRow } from "./shared"

export function ImageSection({ onOpenModels }: { onOpenModels: () => void }) {
  const { t } = useTranslation()
  const [key, setKey] = useState("")
  const [baseUrl, setBaseUrl] = useState("")
  const [showKey, setShowKey] = useState(false)
  const [settings, setSettings] = useState<ImageSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty = useRef(false)
  const pending = useRef(false)
  const mounted = useRef(false)
  const reads = useRef(0)
  dirty.current = key !== "" || (settings !== null && baseUrl !== settings.baseUrl)
  const canSave =
    settings !== null &&
    !saving &&
    (settings.configured || key.trim() !== "") &&
    (key.trim() !== "" || baseUrl.trim() !== settings.baseUrl)
  useEffect(() => {
    mounted.current = true
    const read = () => {
      const request = ++reads.current
      void commands.imagesReadSettings().then(
        (value) => {
          if (!mounted.current || request !== reads.current || dirty.current || pending.current) return
          setSettings(value)
          setBaseUrl(value.baseUrl)
          setError(null)
        },
        (cause: unknown) => {
          if (mounted.current && request === reads.current && !pending.current) setError(String(cause))
        }
      )
    }
    read()
    window.addEventListener("focus", read)
    return () => {
      mounted.current = false
      window.removeEventListener("focus", read)
    }
  }, [])
  const save = async (removeKey = false) => {
    if (!settings || pending.current) return
    pending.current = true
    ++reads.current
    setSaving(true)
    setError(null)
    try {
      const next = await commands.imagesSaveSettings({
        input: {
          baseUrl: removeKey ? settings.baseUrl : baseUrl.trim(),
          apiKey: removeKey ? "" : key.trim() || null,
          expectedRevision: settings.revision
        }
      })
      void emit(IMAGE_PROVIDERS_CHANGED).catch((cause: unknown) => toast.error(String(cause)))
      if (!mounted.current) return
      setSettings(next)
      if (!removeKey) setBaseUrl(next.baseUrl)
      setKey("")
      setShowKey(false)
      toast.success(t(removeKey ? "images.keyRemoved" : "images.settingsSaved"))
    } catch (cause: unknown) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      pending.current = false
      if (mounted.current) setSaving(false)
    }
  }
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
        <form
          className="space-y-5 rounded-xl border p-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (canSave) void save()
          }}
        >
          <div className="flex items-center gap-3">
            <ImageModelIcon provider="seedream" className="size-6" />
            <h3 className="text-sm font-medium">Seedream</h3>
          </div>
          <ProviderConnectionSettings id="seedream-connection">
            <Field className="gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <FieldLabel htmlFor="seedream-api-key">{t("provider.apiKey")}</FieldLabel>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-xs text-muted-foreground"
                  onClick={() =>
                    void openExternal("https://ark.volcengine.com/region:cn-beijing/apikey").catch((cause: unknown) =>
                      toast.error(cause instanceof Error ? cause.message : String(cause))
                    )
                  }
                >
                  {t("images.getKey")}
                  <ExternalLinkIcon className="size-3" aria-hidden="true" />
                </Button>
              </div>
              <InputGroup>
                <InputGroupInput
                  id="seedream-api-key"
                  type={showKey ? "text" : "password"}
                  autoComplete="off"
                  spellCheck={false}
                  aria-label={t("images.seedreamKey")}
                  value={key}
                  disabled={settings === null || saving}
                  onChange={(event) => {
                    dirty.current = true
                    setKey(event.target.value)
                  }}
                  placeholder={settings?.configured ? t("images.configured") : t("images.enterKey")}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    type="button"
                    size="icon-xs"
                    disabled={settings === null || saving}
                    aria-label={t(showKey ? "provider.hideKey" : "provider.showKey")}
                    onClick={() => setShowKey((value) => !value)}
                  >
                    {showKey ? <EyeIcon /> : <EyeOffIcon />}
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
            </Field>
            <ProviderBaseUrl
              id="seedream-base-url"
              value={baseUrl}
              disabled={settings === null || saving}
              placeholder={settings?.defaultBaseUrl}
              onChange={(value) => {
                dirty.current = true
                setBaseUrl(value)
              }}
              description={t("images.baseUrlHint")}
            />
          </ProviderConnectionSettings>
          <div className="flex justify-end gap-2">
            {settings?.configured && (
              <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => void save(true)}>
                {t("images.removeKey")}
              </Button>
            )}
            <Button type="submit" size="sm" disabled={!canSave}>
              {saving && <Spinner data-icon="inline-start" />}
              {t("images.save")}
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
      </SettingGroup>
    </>
  )
}
