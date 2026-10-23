import { DEFAULT_COLLECTION_ID, getCollectionName } from "@alwith/module-collection"
import { BoxIcon, ChevronRightIcon, PlusIcon, StarIcon } from "lucide-react"
import { type ReactElement, useState } from "react"
import { useTranslation } from "react-i18next"

import { HoverInfoAction } from "@/components/alwith-ui/hover-info-card"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { useNavigationHoverCardPin } from "@/features/layout/components/navigation/navigation-session-item"
import { cn } from "@/lib/utils"

import { dispatchCollection, reportCollection, useCollectionStore } from "./store"

export function CollectionPicker({
  sessionId,
  trigger,
  favorite = false,
  allowRemove = true,
  submenu = false,
  className,
  onOpenChange
}: {
  sessionId: string
  trigger?: ReactElement
  favorite?: boolean
  allowRemove?: boolean
  submenu?: boolean
  className?: string
  onOpenChange?: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const pin = useNavigationHoverCardPin()
  const { collections, order } = useCollectionStore()
  const selected = order.find((id) => collections[id].sessionIds.includes(sessionId))
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const changeOpen = (value: boolean) => {
    setOpen(value)
    pin(value)
    onOpenChange?.(value)
    if (!value) {
      setCreating(false)
      setName("")
    }
  }
  const run = (operation: Promise<void>) => {
    setBusy(true)
    reportCollection(
      operation
        .then(() => {
          changeOpen(false)
        })
        .finally(() => setBusy(false))
    )
  }
  return (
    <DropdownMenu
      modal={false}
      open={open}
      onOpenChange={(value, details) => {
        if (!value && creating && details.reason === "trigger-hover") {
          details.cancel()
          return
        }
        changeOpen(value)
      }}
    >
      <DropdownMenuTrigger
        disabled={busy}
        data-hover-background={favorite ? "none" : undefined}
        openOnHover={favorite || submenu}
        aria-label={t(favorite && selected !== undefined ? "collection.removeFromAll" : "collection.addTo")}
        onMouseDown={(event) => {
          if (favorite) event.preventBaseUIHandler()
        }}
        onClick={(event) => {
          if (!favorite) return
          event.preventBaseUIHandler()
          run(dispatchCollection({ type: "favorite", sessionId }))
        }}
        render={
          trigger ?? (
            <Button
              variant="ghost"
              size="icon-sm"
              className={className}
              aria-label={t(favorite && selected !== undefined ? "collection.removeFromAll" : "collection.addTo")}
            >
              <StarIcon className={cn(selected !== undefined && "fill-current")} />
            </Button>
          )
        }
      />
      <DropdownMenuContent
        className="w-56 font-normal"
        side={submenu ? "inline-end" : "bottom"}
        align={submenu ? "start" : "end"}
        sideOffset={4}
      >
        <DropdownMenuGroup>
          <DropdownMenuRadioGroup value={selected ?? null}>
            {order.map((id) => (
              <DropdownMenuRadioItem
                key={id}
                value={id}
                disabled={busy || selected === id}
                closeOnClick={false}
                onClick={() => run(dispatchCollection({ type: "add", collectionId: id, sessionId }))}
              >
                {id === DEFAULT_COLLECTION_ID ? (
                  <StarIcon />
                ) : collections[id].emoji ? (
                  <span className="flex size-4 shrink-0 items-center justify-center text-sm" aria-hidden="true">
                    {collections[id].emoji}
                  </span>
                ) : (
                  <BoxIcon />
                )}
                <span className="min-w-0 flex-1 truncate">{getCollectionName(collections[id], t)}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem disabled={busy} closeOnClick={false} onClick={() => setCreating(true)}>
            <PlusIcon />
            {t("collection.newCollection")}
          </DropdownMenuItem>
          {allowRemove && selected !== undefined && (
            <DropdownMenuItem
              disabled={busy}
              closeOnClick={false}
              onClick={() => run(dispatchCollection({ type: "remove", sessionId }))}
            >
              <StarIcon />
              {t("collection.removeFromAll")}
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
        {creating && (
          <form
            className="flex items-center gap-1 px-2 py-1.5"
            onSubmit={(event) => {
              event.preventDefault()
              event.stopPropagation()
              if (!name.trim() || busy) return
              run(dispatchCollection({ type: "create", id: `collection-${crypto.randomUUID()}`, name, sessionId }))
            }}
          >
            <Input
              autoFocus
              aria-label={t("collection.collectionName")}
              placeholder={t("collection.collectionName")}
              value={name}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
              className="h-7 min-w-0"
            />
            <Button size="xs" type="submit" disabled={busy || !name.trim()}>
              {t("collection.confirm")}
            </Button>
          </form>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function AddToCollectionAction({ sessionId, allowRemove = true }: { sessionId: string; allowRemove?: boolean }) {
  const { t } = useTranslation()
  return (
    <CollectionPicker
      sessionId={sessionId}
      allowRemove={allowRemove}
      submenu
      trigger={
        <HoverInfoAction
          icon={<StarIcon />}
          label={t("collection.addTo")}
          trailing={<ChevronRightIcon className="rtl:rotate-180" />}
        />
      }
    />
  )
}
