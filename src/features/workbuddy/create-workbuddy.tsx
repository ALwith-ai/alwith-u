import { NavigationItemButton } from "@alwith/module-chat/session-list"
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
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Spinner } from "@/components/ui/spinner"
import "./create-workbuddy.css"
import { chooseFolder } from "@/features/chat/draft-project-picker"

export function CreateWorkBuddy({
  onCreated,
  open: controlledOpen,
  onOpenChange
}: {
  onCreated: (directory: string) => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = onOpenChange ?? setInternalOpen
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
      {controlledOpen === undefined && (
        <DialogTrigger render={<NavigationItemButton className="h-8 gap-2 px-2" />}>
          <AppWindowIcon />
          <span>{t("workbuddy.create")}</span>
        </DialogTrigger>
      )}
      <DialogContent className="workbuddy-studio">
        <form
          onSubmit={(event) => {
            void create(event)
          }}
          className="workbuddy-studio-form"
        >
          <DialogHeader className="workbuddy-studio-header">
            <span className="workbuddy-studio-eyebrow">ALwith</span>
            <DialogTitle className="workbuddy-studio-title">{t("workbuddy.headline")}</DialogTitle>
            <DialogDescription>{t("workbuddy.description")}</DialogDescription>
          </DialogHeader>
          <RadioGroup
            className="workbuddy-editions"
            aria-label={t("workbuddy.edition")}
            value={withAuth ? "alwith" : "none"}
            onValueChange={(value) => setWithAuth(value === "alwith")}
            disabled={busy}
          >
            {(["alwith", "none"] as const).map((mode, index) => (
              <label key={mode} className="workbuddy-edition" data-selected={withAuth === (mode === "alwith")}>
                <span className="workbuddy-edition-top">
                  <span>
                    0{index + 1} / {mode === "alwith" ? "COMPANION" : "ESSENTIAL"}
                  </span>
                  <RadioGroupItem
                    value={mode}
                    aria-label={t(mode === "alwith" ? "workbuddy.accountEdition" : "workbuddy.bareEdition")}
                  />
                </span>
                <span className="workbuddy-art" aria-hidden="true">
                  {mode === "alwith" ? (
                    <svg viewBox="0 0 320 140" className="workbuddy-art-svg">
                      <ellipse cx="160" cy="123" rx="77" ry="7" className="art-shadow" />
                      <path d="M101 105V70a59 59 0 0 1 118 0v35h-25V70a34 34 0 0 0-68 0v35z" className="art-arch" />
                      <circle cx="160" cy="91" r="29" className="art-orb" />
                      <circle cx="235" cy="30" r="10" className="art-small" />
                      <path d="M70 39h18m-9-9v18" className="art-line" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 320 140" className="workbuddy-art-svg">
                      <ellipse cx="160" cy="123" rx="77" ry="7" className="art-shadow" />
                      <path d="m109 92 52-70 55 74-53 29z" className="art-fold" />
                      <path d="m161 22 2 103 53-29z" className="art-orb" />
                      <circle cx="87" cy="32" r="14" className="art-small" />
                      <path d="M231 56h18m-9-9v18" className="art-line" />
                    </svg>
                  )}
                </span>
                <span className="workbuddy-edition-title">
                  {t(mode === "alwith" ? "workbuddy.accountEdition" : "workbuddy.bareEdition")}
                </span>
                <span className="workbuddy-edition-description">
                  {t(mode === "alwith" ? "workbuddy.accountCaption" : "workbuddy.bareCaption")}
                </span>
              </label>
            ))}
          </RadioGroup>
          <FieldGroup className="workbuddy-details">
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
            </Field>
          </FieldGroup>
          {error && <FieldError>{error}</FieldError>}
          <DialogFooter className="workbuddy-studio-footer">
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
