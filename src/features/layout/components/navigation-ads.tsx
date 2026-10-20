import Autoplay from "embla-carousel-autoplay"
import useEmblaCarousel from "embla-carousel-react"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { openGamepadWindow } from "@/lib/window-manager"

/** Desktop's campaign order and timing, using U's own surface actions. */
export function NavigationAds({ onOpenVibemon }: { onOpenVibemon?: () => void }) {
  const { t, i18n } = useTranslation()
  const plugins = useMemo(() => [Autoplay({ delay: 5000, stopOnInteraction: false, stopOnMouseEnter: true })], [])
  const [viewport, carousel] = useEmblaCarousel({ loop: true, direction: i18n.dir() }, plugins)
  const campaigns = [
    { id: "vibemon", label: t("sidebar.vibemonAd"), open: onOpenVibemon },
    {
      id: "gamepad",
      label: t("sidebar.gamepadAd"),
      open: () =>
        void openGamepadWindow().catch((error: unknown) =>
          toast.error(error instanceof Error ? error.message : String(error))
        )
    }
  ]
  return (
    <div
      ref={viewport}
      className="overflow-hidden"
      data-slot="navigation-ads"
      onKeyDownCapture={event => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
        event.preventDefault()
        const next = (event.key === "ArrowRight") === (i18n.dir() === "ltr")
        if (next) carousel?.scrollNext()
        else carousel?.scrollPrev()
      }}>
      <div className="flex touch-pan-y">
        {campaigns.map(campaign => (
          <div key={campaign.id} className="flex min-w-0 flex-[0_0_100%]">
            <Button
              variant="ghost"
              aria-label={campaign.label}
              disabled={campaign.open === undefined}
              onClick={campaign.open}
              className="aspect-[16/5] h-auto w-full cursor-pointer overflow-hidden rounded-none border-0 p-0 transition-none active:not-aria-[haspopup]:translate-y-0">
              <img src={`/banner/${campaign.id}.png`} alt="" className="size-full object-cover" draggable={false} />
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}
