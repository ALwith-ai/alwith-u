import { EffortSlider } from "@alwith/module-chat/effort-slider"
import { imageModel, type ImageSelection } from "@alwith/module-chat/image"
import { ChevronDownIcon, ExternalLinkIcon, Settings2Icon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { useImageAvailability } from "@/features/images/availability"
import { ImageModelIcon as ModelIcon } from "@/features/images/model-icon"
import { selectableImageModels as models } from "@/features/images/preferences"
import { openSettingsWindow } from "@/lib/window-manager"

/** Image selection is independent of the conversation's language model. */
export function ImageModelSelect({
  selection,
  onChange,
  disabled
}: {
  selection: ImageSelection
  onChange: (selection: ImageSelection) => void
  disabled: boolean
}) {
  const { t } = useTranslation()
  const availability = useImageAvailability()
  const model = imageModel(selection)
  const hasResolution = model.sizes.length > 1
  const visibleModels = models.filter(
    (entry) => entry.provider === "chatgpt" || availability.seedreamConfigured === true
  )
  const openSettings = () => {
    void openSettingsWindow("images").catch((error: unknown) => toast.error(String(error)))
  }
  if (!availability.available) {
    return (
      <Button
        variant="ghost"
        className="h-7 min-w-0 shrink gap-1.5 rounded-md px-2 text-xs font-normal"
        onClick={openSettings}
      >
        <Settings2Icon aria-hidden="true" />
        <span className="truncate">{t("images.configureModels")}</span>
      </Button>
    )
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            disabled={disabled}
            className="h-7 min-w-0 shrink gap-1.5 rounded-md px-2 text-xs font-normal"
            aria-label={t("chat.inputMode.model")}
          />
        }
      >
        <ModelIcon provider={model.provider} />
        <span className="truncate">{hasResolution ? `${model.label} · ${selection.size}` : model.label}</span>
        <ChevronDownIcon aria-hidden="true" className="size-3 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="end"
        sideOffset={4}
        data-image-model-menu
        className="flex max-h-[min(350px,var(--available-height,350px))] w-max max-w-[min(24rem,calc(100vw-1rem))] min-w-64 flex-col overflow-hidden rounded-xl p-1.5"
      >
        <DropdownMenuGroup className="flex min-w-0 shrink-0 items-center justify-between gap-2">
          <DropdownMenuLabel className="flex h-8 shrink-0 items-center px-2 py-0 whitespace-nowrap">
            {t("chat.inputMode.model")}
          </DropdownMenuLabel>
          {hasResolution && (
            <div role="menuitem" aria-label={t("chat.inputMode.resolution")} className="shrink-0 [&>div]:gap-1">
              <EffortSlider
                key={model.id}
                name={t("chat.inputMode.resolution")}
                value={selection.size}
                levels={model.sizes.map((size) => ({ value: size, name: size }))}
                trackWidth={64}
                onChange={(size) => onChange({ model: model.id, size })}
              />
            </div>
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator className="shrink-0" />
        <DropdownMenuGroup className="min-h-0 min-w-0 overflow-y-auto overscroll-contain">
          <DropdownMenuRadioGroup
            className="min-w-0"
            aria-label={t("chat.inputMode.model")}
            value={model.id}
            onValueChange={(id) => {
              const next = visibleModels.find((entry) => entry.id === id)
              if (!next) throw new Error("Unknown image model")
              const size = (next.sizes as readonly string[]).includes(selection.size) ? selection.size : next.sizes[0]
              onChange({ model: next.id, size })
            }}
          >
            {visibleModels.map((entry) => (
              <DropdownMenuRadioItem
                key={entry.id}
                value={entry.id}
                closeOnClick
                disabled={entry.provider === "chatgpt" && availability.chatgptConnected !== true}
                className="h-8 gap-2 rounded-md ps-2"
              >
                <ModelIcon provider={entry.provider} />
                <span className="min-w-0 truncate">{entry.label}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={openSettings}>
            {t("images.settings")}
            <ExternalLinkIcon className="ml-auto size-4" />
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
