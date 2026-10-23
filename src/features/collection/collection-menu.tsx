import { DEFAULT_COLLECTION_ID, getCollectionName } from "@alwith/module-collection"
import { BoxIcon, ChevronRightIcon, PlusIcon, StarIcon } from "lucide-react"
import { type ReactElement, useState } from "react"
import { useTranslation } from "react-i18next"

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
  favorite = false
}: {
  sessionId: string
  trigger?: ReactElement
  favorite?: boolean
}) {
  const { t } = useTranslation()
  const pin = useNavigationHoverCardPin()
  const { collections, order } = useCollectionStore()
  const selected = order.find((id) => collections[id].sessionIds.includes(sessionId))
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const run = (operation: Promise<void>) => {
    setBusy(true)
    reportCollection(
      operation
        .then(() => {
          setOpen(false)
          pin(false)
          setCreating(false)
          setName("")
        })
        .finally(() => setBusy(false))
    )
  }
  return (
    <DropdownMenu
      modal={false}
      open={open}
      onOpenChange={(value) => {
        setOpen(value)
        pin(value)
      }}
    >
      <DropdownMenuTrigger
        disabled={busy}
        openOnHover={favorite}
        onMouseDown={(event) => {
          if (favorite && selected !== undefined) event.preventBaseUIHandler()
        }}
        onClick={(event) => {
          if (!favorite || selected === undefined) return
          event.preventBaseUIHandler()
          run(dispatchCollection({ type: "remove", sessionId }))
        }}
        render={
          trigger ?? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t(favorite && selected !== undefined ? "collection.removeFromAll" : "collection.addTo")}
            >
              <StarIcon className={cn(selected !== undefined && "fill-current")} />
            </Button>
          )
        }
      />
      <DropdownMenuContent className="w-56" align="end">
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
                  <span>{collections[id].emoji}</span>
                ) : (
                  <BoxIcon />
                )}
                {getCollectionName(collections[id], t)}
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
          {selected !== undefined && (
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

export function AddToCollectionAction({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation()
  return (
    <CollectionPicker
      sessionId={sessionId}
      trigger={
        <Button variant="ghost" className="w-full justify-start px-2">
          <StarIcon />
          <span className="flex-1 text-start">{t("collection.addTo")}</span>
          <ChevronRightIcon />
        </Button>
      }
    />
  )
}
