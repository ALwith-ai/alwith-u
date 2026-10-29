import { NavigationItemButton } from "@alwith/module-chat/session-list"
import { AppWindowIcon, CheckIcon, FolderIcon } from "lucide-react"
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Spinner } from "@/components/ui/spinner"
import "./create-workbuddy.css"
import { save } from "@tauri-apps/plugin-dialog"

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
  const [projectPath, setProjectPath] = useState("")
  const [productName, setProductName] = useState("")
  const [identifier, setIdentifier] = useState("")
  const [github, setGithub] = useState("")
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
      const normalizedPath = projectPath.replaceAll("\\", "/").replace(/\/+$/, "")
      const separator = normalizedPath.lastIndexOf("/")
      const parent = normalizedPath.slice(0, separator + 1)
      const name = normalizedPath.slice(separator + 1)
      directory = await commands.workbuddyCreate({
        parent,
        name,
        productName,
        identifier,
        auth: withAuth ? "alwith" : "none",
        github: github.trim() || null
      })
    } catch (cause) {
      report(cause)
      return
    } finally {
      pending.current = false
      setBusy(false)
    }
    setOpen(false)
    setProjectPath("")
    setProductName("")
    setIdentifier("")
    setGithub("")
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
            <DialogDescription className="sr-only">{t("workbuddy.description")}</DialogDescription>
          </DialogHeader>
          <RadioGroup
            className="workbuddy-editions"
            aria-label={t("workbuddy.edition")}
            value={withAuth ? "alwith" : "none"}
            onValueChange={(value) => setWithAuth(value === "alwith")}
            disabled={busy}
          >
            {(["alwith", "none"] as const).map((mode) => (
              <label key={mode} className="workbuddy-edition" data-selected={withAuth === (mode === "alwith")}>
                <RadioGroupItem
                  className="sr-only"
                  value={mode}
                  aria-label={t(mode === "alwith" ? "workbuddy.accountEdition" : "workbuddy.bareEdition")}
                />
                <span className="workbuddy-edition-top">
                  <span className="workbuddy-edition-title">
                    {t(mode === "alwith" ? "workbuddy.accountEdition" : "workbuddy.bareEdition")}
                  </span>
                  <span className="workbuddy-edition-check" aria-hidden="true">
                    <CheckIcon />
                  </span>
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
            <Field>
              <FieldLabel htmlFor="workbuddy-github">{t("workbuddy.github")}</FieldLabel>
              <Input
                id="workbuddy-github"
                pattern="[A-Za-z0-9]([A-Za-z0-9\-]{0,37}[A-Za-z0-9])?/[A-Za-z0-9_.\-]{1,100}"
                placeholder="owner/repo"
                value={github}
                disabled={busy}
                onChange={(event) => setGithub(event.target.value)}
              />
              <FieldDescription>{t("workbuddy.githubHelp")}</FieldDescription>
            </Field>
            <Field className="workbuddy-location">
              <FieldLabel htmlFor="workbuddy-location">{t("workbuddy.location")}</FieldLabel>
              <div className="flex items-center gap-2">
                <Input
                  id="workbuddy-location"
                  required
                  value={projectPath}
                  disabled={busy}
                  onChange={(event) => setProjectPath(event.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={busy}
                  aria-label={t("workbuddy.chooseLocation")}
                  onClick={() => {
                    const suggested = productName
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, "-")
                      .replace(/^-+|-+$/g, "")
                    void save({
                      title: t("workbuddy.chooseLocation"),
                      defaultPath: projectPath || (/^[a-z]/.test(suggested) ? suggested : "my-alwith")
                    })
                      .then((value) => {
                        if (value) setProjectPath(value)
                      })
                      .catch(report)
                  }}
                >
                  <FolderIcon />
                </Button>
              </div>
            </Field>
          </FieldGroup>
          {error && <FieldError>{error}</FieldError>}
          <DialogFooter className="workbuddy-studio-footer">
            <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              {t("actions.cancel")}
            </Button>
            <Button type="submit" disabled={busy || !projectPath}>
              {busy && <Spinner data-icon="inline-start" />}
              {t(busy ? "workbuddy.creating" : "workbuddy.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
