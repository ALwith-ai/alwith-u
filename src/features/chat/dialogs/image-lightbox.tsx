import type { ActivityImage } from "@alwith/module-chat/activity-host"
// Ported from ALwith Desktop's image-lightbox.tsx.
// Any image in the thread opens it through `openImageLightbox`.
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { create } from "zustand"

import { Button } from "@/components/alwith-ui/button"
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog"

type LightboxState = { images: ActivityImage[]; index: number }

const useLightbox = create<LightboxState>(() => ({ images: [], index: 0 }))

export function openImageLightbox(src: string, alt = ""): void {
  openImageGallery([{ src, alt }], 0)
}

export function openImageGallery(images: ActivityImage[], index: number): void {
  if (images[index] === undefined) throw new Error("Image gallery index is out of range")
  useLightbox.setState({ images, index })
}

function moveImage(direction: number): void {
  useLightbox.setState((state) => ({
    index: Math.max(0, Math.min(state.images.length - 1, state.index + direction))
  }))
}

export function ImageLightbox() {
  const { t } = useTranslation()
  const { images, index } = useLightbox()
  const image = images[index]
  return (
    <Dialog open={image !== undefined} onOpenChange={(open) => !open && useLightbox.setState({ images: [], index: 0 })}>
      <DialogContent
        showCloseButton={false}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault()
            moveImage(event.key === "ArrowLeft" ? -1 : 1)
          }
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) useLightbox.setState({ images: [], index: 0 })
        }}
        className="fixed inset-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 items-center justify-center rounded-none bg-transparent p-0 ring-0 sm:max-w-none data-open:zoom-in-100 data-closed:zoom-out-100"
      >
        <DialogTitle className="sr-only">{t("chat.image.view")}</DialogTitle>
        {image !== undefined && (
          <img src={image.src} alt={image.alt} className="max-h-[90vh] max-w-[90vw] rounded-md object-contain" />
        )}
        {images.length > 1 && (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              className="absolute start-3 top-1/2 bg-transparent text-foreground hover:bg-transparent dark:hover:bg-transparent"
              aria-label={t("chat.image.previous")}
              title={t("chat.image.previous")}
              shortcut="ArrowLeft"
              disabled={index === 0}
              onClick={() => moveImage(-1)}
            >
              <ChevronLeftIcon aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="absolute end-3 top-1/2 bg-transparent text-foreground hover:bg-transparent dark:hover:bg-transparent"
              aria-label={t("chat.image.next")}
              title={t("chat.image.next")}
              shortcut="ArrowRight"
              disabled={index === images.length - 1}
              onClick={() => moveImage(1)}
            >
              <ChevronRightIcon aria-hidden="true" />
            </Button>
            <span
              className="absolute bottom-3 rounded-md bg-popover px-2 py-1 text-xs text-popover-foreground"
              aria-live="polite"
            >
              {index + 1} / {images.length}
            </span>
          </>
        )}
        <DialogClose
          aria-label={t("actions.close")}
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              title={t("actions.close")}
              shortcut="Escape"
              className="absolute top-4 right-4 z-10 cursor-pointer rounded-[8px] border-0 bg-transparent text-foreground active:bg-muted"
            />
          }
        >
          <XIcon aria-hidden="true" />
        </DialogClose>
      </DialogContent>
    </Dialog>
  )
}
