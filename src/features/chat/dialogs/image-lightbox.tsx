// Ported from ALwith Desktop's image-lightbox.tsx: a full-screen view of one image.
// Any image in the thread opens it through `openImageLightbox`.
import { useTranslation } from "react-i18next"
import { create } from "zustand"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"

type LightboxState = { image: { src: string; alt: string } | null }

const useLightbox = create<LightboxState>(() => ({ image: null }))

export function openImageLightbox(src: string, alt = ""): void {
  useLightbox.setState({ image: { src, alt } })
}

export function ImageLightbox() {
  const { t } = useTranslation()
  const image = useLightbox(state => state.image)
  return (
    <Dialog open={image !== null} onOpenChange={open => !open && useLightbox.setState({ image: null })}>
      <DialogContent
        showCloseButton={false}
        className="flex max-w-[calc(100%-2rem)] items-center justify-center bg-transparent p-0 ring-0 sm:max-w-[90vw]">
        <DialogTitle className="sr-only">{t("chat.image.view")}</DialogTitle>
        {image !== null && (
          <img src={image.src} alt={image.alt} className="max-h-[90vh] max-w-[90vw] rounded-md object-contain" />
        )}
      </DialogContent>
    </Dialog>
  )
}
