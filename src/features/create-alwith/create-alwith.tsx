import { NavigationItemButton } from "@alwith/module-chat/session-list"
import { AppWindowIcon, CheckIcon, FolderIcon } from "lucide-react"
import { type SubmitEvent, useRef, useState } from "react"
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
import "./create-alwith.css"
import { save } from "@tauri-apps/plugin-dialog"

export function CreateAlwith({
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

  async function create(event: SubmitEvent<HTMLFormElement>) {
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
      directory = await commands.createAlwith({
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
          <span>{t("createAlwith.create")}</span>
        </DialogTrigger>
      )}
      <DialogContent className="create-alwith-studio">
        <form
          onSubmit={(event) => {
            void create(event)
          }}
          className="create-alwith-studio-form"
        >
          <DialogHeader className="create-alwith-studio-header">
            <span className="create-alwith-studio-eyebrow">ALwith</span>
            <DialogTitle className="create-alwith-studio-title">{t("createAlwith.headline")}</DialogTitle>
            <DialogDescription className="sr-only">{t("createAlwith.description")}</DialogDescription>
          </DialogHeader>
          <RadioGroup
            className="create-alwith-editions"
            aria-label={t("createAlwith.edition")}
            value={withAuth ? "alwith" : "none"}
            onValueChange={(value) => setWithAuth(value === "alwith")}
            disabled={busy}
          >
            {(["alwith", "none"] as const).map((mode) => (
              <label key={mode} className="create-alwith-edition" data-selected={withAuth === (mode === "alwith")}>
                <RadioGroupItem
                  className="sr-only"
                  value={mode}
                  aria-label={t(mode === "alwith" ? "createAlwith.accountEdition" : "createAlwith.bareEdition")}
                />
                <span className="create-alwith-edition-top">
                  <span className="create-alwith-edition-title">
                    {t(mode === "alwith" ? "createAlwith.accountEdition" : "createAlwith.bareEdition")}
                  </span>
                  <span className="create-alwith-edition-check" aria-hidden="true">
                    <CheckIcon />
                  </span>
                </span>
                <span className="create-alwith-edition-description">
                  {t(mode === "alwith" ? "createAlwith.accountCaption" : "createAlwith.bareCaption")}
                </span>
              </label>
            ))}
          </RadioGroup>
          <FieldGroup className="create-alwith-details">
            <Field>
              <FieldLabel htmlFor="create-alwith-product">{t("createAlwith.productName")}</FieldLabel>
              <Input
                id="create-alwith-product"
                required
                value={productName}
                disabled={busy}
                onChange={(event) => setProductName(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="create-alwith-identifier">{t("createAlwith.identifier")}</FieldLabel>
              <Input
                id="create-alwith-identifier"
                required
                pattern="[A-Za-z][A-Za-z0-9\-]*(\.[A-Za-z][A-Za-z0-9\-]*){2,}"
                placeholder="com.example.myapp"
                value={identifier}
                disabled={busy}
                onChange={(event) => setIdentifier(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="create-alwith-github">{t("createAlwith.github")}</FieldLabel>
              <Input
                id="create-alwith-github"
                pattern="[A-Za-z0-9]([A-Za-z0-9\-]{0,37}[A-Za-z0-9])?/[A-Za-z0-9_.\-]{1,100}"
                placeholder="owner/repo"
                value={github}
                disabled={busy}
                onChange={(event) => setGithub(event.target.value)}
              />
              <FieldDescription>{t("createAlwith.githubHelp")}</FieldDescription>
            </Field>
            <Field className="create-alwith-location">
              <FieldLabel htmlFor="create-alwith-location">{t("createAlwith.location")}</FieldLabel>
              <div className="flex items-center gap-2">
                <Input
                  id="create-alwith-location"
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
                  aria-label={t("createAlwith.chooseLocation")}
                  onClick={() => {
                    const suggested = productName
                      .toLowerCase()
                      .replaceAll(/[^a-z0-9]+/g, "-")
                      .replaceAll(/^-+|-+$/g, "")
                    void save({
                      title: t("createAlwith.chooseLocation"),
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
          <DialogFooter className="create-alwith-studio-footer">
            <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              {t("actions.cancel")}
            </Button>
            <Button type="submit" disabled={busy || !projectPath}>
              {busy && <Spinner data-icon="inline-start" />}
              {t(busy ? "createAlwith.creating" : "createAlwith.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
