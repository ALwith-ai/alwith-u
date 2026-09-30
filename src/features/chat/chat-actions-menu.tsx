import type { Session } from "@alwith/api"
import {
  ArrowUpRightIcon,
  FolderPlusIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PictureInPicture2Icon,
  PlusIcon,
  SearchIcon,
  Trash2Icon
} from "lucide-react"
import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { hasRename } from "@/agent/codex-extensions"
import { OverflowMarquee } from "@/components/alwith-ui/overflow-marquee"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { client, useApp } from "@/lib/client"
import { openChatSearch } from "./dialogs/chat-search"
import { ExternalEditorMenu, ProjectAppIcon, useProjectApps } from "./open-in-editor"

/** Shared by main and floating chats. Mutations always address the displayed session. */
export function ChatActionsMenu({
  session,
  surface,
  onOpenWindow,
  cwd,
  onNewChat,
  onNewProject,
  onDeleted
}: {
  session?: Session
  surface: "main" | "floating"
  onOpenWindow?: () => void
  cwd: string | null
  onNewChat: () => void
  onNewProject?: () => void
  onDeleted?: (sessionId: string) => void
}) {
  const { t } = useTranslation()
  const canRename = useApp(state => hasRename(state.agent))
  const connected = useApp(state => state.connection === "ready")
  // Keep the apps outside the popup lifecycle, including on the empty main chat.
  const editor = useProjectApps(cwd)
  const [dialog, setDialog] = useState<"rename" | "delete" | null>(null)
  const [name, setName] = useState("")
  const [pending, setPending] = useState(false)
  const submitting = useRef(false)
  const skipMenuFocus = useRef(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const report = (error: unknown) => toast.error(error instanceof Error ? error.message : String(error))
  const submit = async () => {
    if (!session || submitting.current || dialog === null) return
    submitting.current = true
    setPending(true)
    try {
      if (dialog === "rename") {
        await client.renameSession(session.id, name.trim())
      } else {
        await client.delete(session.id)
        onDeleted?.(session.id)
      }
      setDialog(null)
    } catch (error) {
      report(error)
    } finally {
      submitting.current = false
      setPending(false)
    }
  }
  const canMutate = session !== undefined && connected && !session.restoring
  const hasMessages = session !== undefined && session.items.length > 0
  const canOpenWindow = surface === "main" && onOpenWindow !== undefined && !session?.restoring
  const showNewChat = surface === "floating" && session !== undefined
  const showNewProject = surface === "floating" && onNewProject !== undefined
  const showCreationActions = showNewChat || showNewProject
  const showChatActions = canOpenWindow || (canMutate && canRename) || hasMessages
  if (!session && cwd === null && !canOpenWindow && !showNewProject) return null
  return (
    <>
      <DropdownMenu
        onOpenChange={open => {
          if (open) skipMenuFocus.current = false
        }}>
        <DropdownMenuTrigger
          render={
            <Button
              ref={trigger}
              variant="ghost"
              size="icon-sm"
              className="hover:bg-foreground/8 aria-expanded:bg-foreground/8 dark:hover:bg-foreground/8 transition-colors duration-150 ease-out"
              aria-label={t("actions.more")}
              title={t("actions.more")}
            />
          }>
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="max-w-[calc(100vw-2rem)] min-w-56"
          finalFocus={() => !skipMenuFocus.current}>
          {showCreationActions && (
            <DropdownMenuGroup>
              {showNewChat && (
                <DropdownMenuItem
                  onClick={() => {
                    skipMenuFocus.current = true
                    onNewChat()
                  }}>
                  <PlusIcon />
                  {t("sidebar.newChat")}
                </DropdownMenuItem>
              )}
              {showNewProject && (
                <DropdownMenuItem onClick={onNewProject}>
                  <FolderPlusIcon />
                  {t("chat.draft.newProject")}
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
          )}
          {showChatActions && (
            <>
              {showCreationActions && <DropdownMenuSeparator />}
              <DropdownMenuGroup>
                {canOpenWindow && (
                  <DropdownMenuItem
                    onClick={() => {
                      skipMenuFocus.current = true
                      onOpenWindow()
                    }}>
                    <PictureInPicture2Icon />
                    {t("chatWindow.open")}
                  </DropdownMenuItem>
                )}
                {canMutate && canRename && (
                  <DropdownMenuItem
                    onClick={() => {
                      skipMenuFocus.current = true
                      setName(session.title ?? "")
                      setDialog("rename")
                    }}>
                    <PencilIcon />
                    {t("sidebar.rename")}
                  </DropdownMenuItem>
                )}
                {hasMessages && (
                  <DropdownMenuItem
                    onClick={() => {
                      skipMenuFocus.current = true
                      openChatSearch(session.id)
                    }}>
                    <SearchIcon />
                    {t("chat.search.label")}
                  </DropdownMenuItem>
                )}
              </DropdownMenuGroup>
            </>
          )}
          {cwd !== null &&
            (surface === "main" ? (
              <ExternalEditorMenu editor={editor} separator={showChatActions} />
            ) : (
              <>
                {(showCreationActions || showChatActions) && <DropdownMenuSeparator />}
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    className="group/path"
                    aria-label={t("actions.openFolder")}
                    title={editor.active ? `${t("actions.openProjectWith", { app: editor.active.name })}\n${cwd}` : cwd}
                    onClick={() => void editor.openPreferred().catch(report)}>
                    <ProjectAppIcon app={editor.active} />
                    <OverflowMarquee className="flex-1">{cwd}</OverflowMarquee>
                    <ArrowUpRightIcon
                      aria-hidden="true"
                      className="invisible shrink-0 group-hover/path:visible group-focus-visible/path:visible group-data-highlighted/path:visible"
                    />
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </>
            ))}
          {canMutate && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => {
                    skipMenuFocus.current = true
                    setDialog("delete")
                  }}>
                  <Trash2Icon />
                  {t("sidebar.delete")}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog
        open={dialog !== null}
        onOpenChange={open => {
          if (!open && !submitting.current) setDialog(null)
        }}>
        <DialogContent finalFocus={trigger}>
          <form
            className="grid gap-4"
            onSubmit={event => {
              event.preventDefault()
              if (dialog !== "rename" || name.trim()) void submit()
            }}>
            <DialogHeader>
              <DialogTitle>{t(dialog === "delete" ? "sidebar.deleteTitle" : "sidebar.rename")}</DialogTitle>
              {dialog === "delete" && <DialogDescription>{t("sidebar.deleteDescription")}</DialogDescription>}
            </DialogHeader>
            {dialog === "rename" && (
              <Input
                aria-label={t("sidebar.rename")}
                value={name}
                disabled={pending}
                onChange={event => setName(event.target.value)}
                onFocus={event => event.target.select()}
              />
            )}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={pending} onClick={() => setDialog(null)}>
                {t("actions.cancel")}
              </Button>
              <Button
                type="submit"
                variant={dialog === "delete" ? "destructive" : "default"}
                disabled={pending || (dialog === "rename" && !name.trim())}>
                {t(dialog === "delete" ? "sidebar.delete" : "sidebar.rename")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
