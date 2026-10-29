import { NavigationItemButton } from "@alwith/module-chat/session-list"
import { openUrl } from "@tauri-apps/plugin-opener"
import { AppWindowIcon, FolderIcon } from "lucide-react"
import { type FormEvent, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { commands } from "@/bindings"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { chooseFolder } from "@/features/chat/draft-project-picker"

export function CreateWorkBuddy({ onCreated }: { onCreated: (directory: string) => void }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [parent, setParent] = useState("")
  const [name, setName] = useState("")
  const [productName, setProductName] = useState("")
  const [identifier, setIdentifier] = useState("")
  const [withAuth, setWithAuth] = useState(true)
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const report = (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause))

  async function create(event: FormEvent) {
    event.preventDefault()
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError(null)
    let directory: string
    try {
      directory = await commands.workbuddyCreate({
        parent,
        name,
        productName,
        identifier,
        auth: withAuth ? "alwith" : "none"
      })
    } catch (cause) {
      report(cause)
      return
    } finally {
      pending.current = false
      setBusy(false)
    }
    setOpen(false)
    setName("")
    setProductName("")
    setIdentifier("")
    onCreated(directory)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!pending.current) {
          setOpen(value)
          setError(null)
        }
      }}
    >
      <DialogTrigger render={<NavigationItemButton className="h-8 gap-2 px-2" />}>
        <AppWindowIcon />
        <span>{t("workbuddy.create")}</span>
      </DialogTrigger>
      <DialogContent>
        <form
          onSubmit={(event) => {
            void create(event)
          }}
          className="flex flex-col gap-4"
        >
          <DialogHeader>
            <DialogTitle>{t("workbuddy.create")}</DialogTitle>
            <DialogDescription>{t("workbuddy.description")}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-disabled={busy}>
              <div className="flex items-center justify-between gap-4">
                <FieldLabel htmlFor="workbuddy-auth">{t("workbuddy.auth")}</FieldLabel>
                <Switch id="workbuddy-auth" checked={withAuth} onCheckedChange={setWithAuth} disabled={busy} />
              </div>
              <FieldDescription>{t(withAuth ? "workbuddy.authEnabled" : "workbuddy.authDisabled")}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="workbuddy-product">{t("workbuddy.productName")}</FieldLabel>
              <Input
                id="workbuddy-product"
                required
                value={productName}
                disabled={busy}
                onChange={(event) => setProductName(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="workbuddy-name">{t("workbuddy.packageName")}</FieldLabel>
              <Input
                id="workbuddy-name"
                required
                pattern="[a-z][a-z0-9\-]{0,213}"
                value={name}
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
              />
              <FieldDescription>{t("workbuddy.nameHelp")}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="workbuddy-parent">{t("workbuddy.parent")}</FieldLabel>
              <div className="flex items-center gap-2">
                <Input id="workbuddy-parent" required value={parent} readOnly />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={busy}
                  aria-label={t("workbuddy.chooseFolder")}
                  onClick={() => {
                    void chooseFolder(parent || null)
                      .then((value) => {
                        if (value) setParent(value)
                      })
                      .catch(report)
                  }}
                >
                  <FolderIcon />
                </Button>
              </div>
            </Field>
            <Field>
              <FieldLabel htmlFor="workbuddy-identifier">{t("workbuddy.identifier")}</FieldLabel>
              <Input
                id="workbuddy-identifier"
                required
                pattern="[A-Za-z][A-Za-z0-9\-]*(\.[A-Za-z][A-Za-z0-9\-]*){2,}"
                placeholder="com.example.myapp"
                value={identifier}
                disabled={busy}
                onChange={(event) => setIdentifier(event.target.value)}
              />
              <FieldDescription>{t("workbuddy.identifierHelp")}</FieldDescription>
              <Button
                type="button"
                variant="link"
                className="w-fit px-0"
                disabled={busy}
                onClick={() => {
                  void openUrl("https://developer.apple.com/account/resources/identifiers/list").catch(report)
                }}
              >
                {t("workbuddy.appleIdentifiers")}
              </Button>
            </Field>
          </FieldGroup>
          {error && <FieldError>{error}</FieldError>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              {t("actions.cancel")}
            </Button>
            <Button type="submit" disabled={busy || !parent}>
              {busy && <Spinner data-icon="inline-start" />}
              {t(busy ? "workbuddy.creating" : "workbuddy.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
