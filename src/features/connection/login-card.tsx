import type * as acp from "@agentclientprotocol/sdk/experimental/v2"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"

function methodLabel(method: acp.AuthMethod, t: (key: string) => string): string {
  switch (method.methodId) {
    case "chat-gpt":
      return t("connection.signIn")
    case "chat-gpt-device-code":
      return t("connection.signInDevice")
    case "api-key":
      return t("connection.signInApiKey")
    default:
      return method.name
  }
}

export function LoginCard({
  methods,
  signIn
}: {
  methods: acp.AuthMethod[]
  signIn: (methodId: string, extra: Record<string, unknown>) => Promise<void>
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState<string | null>(null)
  const [apiKeyOpen, setApiKeyOpen] = useState(false)
  const [apiKey, setApiKey] = useState("")

  const login = async (methodId: string, extra: Record<string, unknown> = {}) => {
    setBusy(methodId)
    try {
      await signIn(methodId, extra)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>{t("connection.signIn")}</EmptyTitle>
        <EmptyDescription>{t("connection.signInHint")}</EmptyDescription>
      </EmptyHeader>
      <div className="flex flex-wrap justify-center gap-2">
        {methods.map((method, index) => (
          <Button
            key={method.methodId}
            variant={index === 0 ? "default" : "outline"}
            disabled={busy !== null}
            onClick={() => (method.methodId === "api-key" ? setApiKeyOpen(true) : void login(method.methodId))}>
            {busy === method.methodId && <Spinner data-icon="inline-start" />}
            {methodLabel(method, t)}
          </Button>
        ))}
      </div>
      <Dialog open={apiKeyOpen} onOpenChange={setApiKeyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("connection.apiKeyTitle")}</DialogTitle>
            <DialogDescription>{t("connection.signInApiKey")}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="api-key">{t("connection.apiKeyTitle")}</FieldLabel>
              <Input
                id="api-key"
                type="password"
                autoComplete="off"
                placeholder={t("connection.apiKeyPlaceholder")}
                value={apiKey}
                onChange={event => setApiKey(event.target.value)}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApiKeyOpen(false)}>
              {t("actions.cancel")}
            </Button>
            <Button
              disabled={apiKey.trim().length === 0 || busy !== null}
              onClick={() => {
                setApiKeyOpen(false)
                void login("api-key", { "api-key": { apiKey: apiKey.trim() } })
              }}>
              {t("actions.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Empty>
  )
}
