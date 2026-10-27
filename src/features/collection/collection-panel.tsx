import { type Collection, DEFAULT_COLLECTION_ID, getCollectionName } from "@alwith/module-collection"
import {
  closestCorners,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors
} from "@dnd-kit/core"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  BrushCleaningIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  StarIcon,
  Trash2Icon
} from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import type { ThreadSummary } from "@/agent/client"
import { Pane } from "@/components/alwith-ui/pane"
import { MENU_HIGHLIGHT } from "@/components/alwith-ui/surface-highlight"
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
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { NavigationGroup } from "@/features/layout/components/navigation/navigation-group"
import { NavigationItemButton } from "@/features/layout/components/navigation/navigation-item"
import { NavigationLeading } from "@/features/layout/components/navigation/navigation-leading"
import { NavigationStack } from "@/features/layout/components/navigation/navigation-stack"
import { client, useApp } from "@/lib/client"
import { isMac } from "@/lib/platform"
import { cn } from "@/lib/utils"

import { CollectionEmoji } from "./collection-emoji"
import { dispatchCollection, reportCollection, useCollectionStore } from "./store"

function SortableRow({
  collectionId,
  sessionId,
  children
}: {
  collectionId: string
  sessionId: string
  children: ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: JSON.stringify([collectionId, sessionId]),
    data: { type: "session", collectionId, sessionId }
  })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("w-full min-w-0", isDragging && "opacity-50")}
      {...attributes}
      {...listeners}
      role="group"
    >
      {children}
    </div>
  )
}

function CollectionSection({
  collection,
  children,
  onEdit,
  onConfirm,
  onNewChat
}: {
  collection: Collection
  children: ReactNode
  onEdit: () => void
  onConfirm: (action: "clear" | "delete") => void
  onNewChat: () => void
}) {
  const { t } = useTranslation()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: collection.id,
    disabled: { draggable: collection.id === DEFAULT_COLLECTION_ID, droppable: false },
    data: { type: "collection" }
  })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("w-full min-w-0", isDragging && "opacity-50")}
    >
      <NavigationGroup
        open={!collection.collapsed}
        onOpenChange={(collapsed) =>
          reportCollection(dispatchCollection({ type: "collapse", id: collection.id, collapsed: !collapsed }))
        }
        label={getCollectionName(collection, t)}
        count={collection.sessionIds.length}
        leading={
          collection.id === DEFAULT_COLLECTION_ID ? (
            <StarIcon className="size-3.5" />
          ) : (
            <CollectionEmoji
              emoji={collection.emoji}
              onChange={(emoji) => reportCollection(dispatchCollection({ type: "emoji", id: collection.id, emoji }))}
            />
          )
        }
        wrapHeader={(header) => (
          <div {...attributes} {...listeners} role="group">
            {header}
          </div>
        )}
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-5"
                  aria-label={t("collection.more", { name: getCollectionName(collection, t) })}
                >
                  <MoreHorizontalIcon className="size-3.5" />
                </Button>
              }
            />
            <DropdownMenuContent>
              <DropdownMenuGroup>
                {collection.id !== DEFAULT_COLLECTION_ID && (
                  <DropdownMenuItem onClick={onEdit}>
                    <PencilIcon />
                    {t("sidebar.rename")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={onNewChat}>
                  <PlusIcon />
                  {t("collection.newChat")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onConfirm("clear")}>
                  <BrushCleaningIcon />
                  {t("collection.clearCollection")}
                </DropdownMenuItem>
                {collection.id !== DEFAULT_COLLECTION_ID && (
                  <DropdownMenuItem variant="destructive" onClick={() => onConfirm("delete")}>
                    <Trash2Icon />
                    {t("collection.deleteCollection")}
                  </DropdownMenuItem>
                )}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      >
        {children}
      </NavigationGroup>
    </div>
  )
}

export function CollectionPanel({
  renderRow,
  onSelect,
  onNewChat
}: {
  renderRow: (thread: ThreadSummary, onHover: (open: boolean) => void, collectionId?: string) => ReactNode
  onSelect: (thread: ThreadSummary) => void
  onNewChat: (collectionId: string) => void
}) {
  const { t } = useTranslation()
  const { collections, order } = useCollectionStore()
  const threads = useApp((state) => state.threads)
  const archivedThreads = useApp((state) => state.archivedThreads)
  const loaded = useApp((state) => state.threadsLoaded)
  const error = useApp((state) => state.threadsError)
  const byId = new Map([...archivedThreads, ...threads].map((thread) => [thread.sessionId, thread]))
  const [editing, setEditing] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [emoji, setEmoji] = useState("")
  const [confirmation, setConfirmation] = useState<{ id: string; type: "clear" | "delete" } | null>(null)
  const [busy, setBusy] = useState(false)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  const flat = order.flatMap((id) =>
    collections[id].collapsed
      ? []
      : collections[id].sessionIds.flatMap((sid) => {
          const thread = byId.get(sid)
          return thread && !thread.archived ? [thread] : []
        })
  )
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat || event.shiftKey || event.altKey) return
      if (isMac() ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey) return
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')) return
      if (
        event.target instanceof HTMLElement &&
        (event.target.isContentEditable || event.target.closest("input,textarea,[role=dialog],[role=menu]"))
      )
        return
      const index = Number(event.key) - 1
      if (!Number.isInteger(index) || index < 0 || index > 8 || !flat[index]) return
      event.preventDefault()
      onSelect(flat[index])
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [flat, onSelect])
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over === null) return
    const source = active.data.current
    const target = over.data.current
    if (source?.type === "session" && target !== undefined) {
      const collectionId = target.type === "session" ? String(target.collectionId) : String(over.id)
      reportCollection(
        dispatchCollection({
          type: "move",
          sourceCollectionId: String(source.collectionId),
          collectionId,
          sessionId: String(source.sessionId),
          index:
            target.type === "session"
              ? collections[collectionId].sessionIds.indexOf(String(target.sessionId))
              : undefined
        })
      )
    } else if (
      source?.type === "collection" &&
      target?.type === "collection" &&
      String(over.id) !== DEFAULT_COLLECTION_ID
    ) {
      reportCollection(
        dispatchCollection({ type: "reorder", id: String(active.id), index: order.indexOf(String(over.id)) })
      )
    }
  }
  const finish = (operation: Promise<void>, close: () => void) => {
    setBusy(true)
    reportCollection(operation.then(close).finally(() => setBusy(false)))
  }
  return (
    <>
      <Pane className="thread-sidebar-scroll" viewportClassName="ps-2 pe-0 pb-1">
        <NavigationStack>
          <NavigationItemButton
            className={cn(MENU_HIGHLIGHT, "font-normal")}
            onClick={() => {
              setEditing("new")
              setName("")
              setEmoji("")
            }}
          >
            <NavigationLeading>
              <PlusIcon />
            </NavigationLeading>
            <span>{t("collection.newCollection")}</span>
          </NavigationItemButton>
          {error && (
            <div className="px-2 text-sm text-muted-foreground">
              <p role="alert">{error}</p>
              <Button variant="ghost" onClick={() => reportCollection(client.listThreads({ reset: true }))}>
                {t("collection.retry")}
              </Button>
            </div>
          )}
          <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
            <SortableContext items={order} strategy={verticalListSortingStrategy}>
              <NavigationStack>
                {order.map((id) => (
                  <CollectionSection
                    key={id}
                    collection={collections[id]}
                    onNewChat={() => onNewChat(id)}
                    onEdit={() => {
                      setEditing(id)
                      setName(collections[id].name)
                      setEmoji(collections[id].emoji ?? "")
                    }}
                    onConfirm={(type) => setConfirmation({ id, type })}
                  >
                    <SortableContext
                      items={collections[id].sessionIds.map((sid) => JSON.stringify([id, sid]))}
                      strategy={verticalListSortingStrategy}
                    >
                      {collections[id].sessionIds.map((sid) => {
                        const thread = byId.get(sid)
                        if (thread?.archived) return null
                        if (!thread)
                          return loaded ? (
                            <div
                              key={sid}
                              className="flex h-[var(--navigation-row-height)] w-full items-center gap-1 rounded-[10px] ps-1 pe-1.5 text-sm font-normal text-muted-foreground"
                            >
                              <NavigationLeading>
                                <MessageSquareIcon className="size-3.5" />
                              </NavigationLeading>
                              <span className="min-w-0 flex-1 truncate">{t("collection.unavailable")}</span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-5 [&_svg]:size-3.5"
                                aria-label={t("collection.removeFromGroup")}
                                onClick={() =>
                                  reportCollection(
                                    dispatchCollection({ type: "remove", sessionId: sid, collectionId: id })
                                  )
                                }
                              >
                                <Trash2Icon />
                              </Button>
                            </div>
                          ) : null
                        return (
                          <SortableRow key={sid} collectionId={id} sessionId={sid}>
                            {renderRow(thread, () => {}, id)}
                          </SortableRow>
                        )
                      })}
                    </SortableContext>
                  </CollectionSection>
                ))}
              </NavigationStack>
            </SortableContext>
          </DndContext>
        </NavigationStack>
      </Pane>
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setEditing(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t(editing === "new" ? "collection.newCollection" : "sidebar.rename")}</DialogTitle>
            <DialogDescription>{t("collection.collectionName")}</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (editing === null || !name.trim() || busy) return
              const id = editing === "new" ? `collection-${crypto.randomUUID()}` : editing
              finish(
                dispatchCollection([
                  editing === "new" ? { type: "create", id, name } : { type: "rename", id, name },
                  { type: "emoji", id, emoji }
                ]),
                () => setEditing(null)
              )
            }}
            className="flex flex-col gap-3"
          >
            <Input
              autoFocus
              aria-label={t("collection.collectionName")}
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={busy}
            />
            {editing !== "new" && <CollectionEmoji emoji={emoji} onChange={setEmoji} />}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setEditing(null)}>
                {t("collection.cancel")}
              </Button>
              <Button type="submit" disabled={busy || !name.trim()}>
                {t("collection.confirm")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirmation(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t(confirmation?.type === "delete" ? "collection.deleteCollection" : "collection.clearCollection")}
            </DialogTitle>
            <DialogDescription>
              {t("collection.confirmCollectionChange", {
                name: confirmation === null ? "" : getCollectionName(collections[confirmation.id], t)
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setConfirmation(null)}>
              {t("collection.cancel")}
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                if (confirmation !== null)
                  finish(dispatchCollection({ type: confirmation.type, id: confirmation.id }), () =>
                    setConfirmation(null)
                  )
              }}
            >
              {t("collection.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
