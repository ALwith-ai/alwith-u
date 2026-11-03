import { EffortSlider } from "@alwith/module-chat/effort-slider"
import { imageModel } from "@alwith/module-chat/image"
import { ChevronDownIcon, ExternalLinkIcon } from "lucide-react"
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
import { openSettingsWindow } from "@/lib/window-manager"

import { useImageAvailability } from "./availability"
import { ImageModelIcon } from "./model-icon"
import { refreshImageProviders, saveImageSelection, selectableImageModels, useImagePreferences } from "./preferences"

export function ImageModelSelect() {
  const { t } = useTranslation()
  const selection = useImagePreferences((state) => state.selection)
  const availability = useImageAvailability()
  const models = selectableImageModels.filter((entry) =>
    entry.provider === "chatgpt" ? availability.chatgptConnected === true : availability.seedreamConfigured === true
  )
  const model = imageModel(selection)
  const hasResolution = model.sizes.length > 1
  const label = hasResolution ? `${model.label} · ${selection.size}` : model.label
  if (!availability.available) return null
  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) void refreshImageProviders().catch((error: unknown) => toast.error(String(error)))
      }}
    >
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            className="h-7 min-w-0 shrink gap-1.5 rounded-md px-2 text-xs font-normal"
            aria-label={t("images.model")}
          />
        }
      >
        <ImageModelIcon provider={model.provider} />
        <span className="truncate">{label}</span>
        <ChevronDownIcon className="size-3 shrink-0" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="end"
        sideOffset={4}
        data-image-model-menu
        className="z-100 flex h-auto max-w-[min(24rem,calc(100vw-1rem))] min-w-0 flex-col overflow-hidden rounded-xl p-1.5"
        style={{
          height: "auto",
          maxHeight: "min(350px, var(--available-height, 350px))"
        }}
      >
        <DropdownMenuGroup className="flex min-w-0 shrink-0 items-center justify-between gap-2">
          <DropdownMenuLabel className="flex h-8 min-w-0 flex-1 items-center px-2 py-0">
            <span className="truncate">{t("images.model")}</span>
          </DropdownMenuLabel>
          {hasResolution && (
            <div
              role="menuitem"
              aria-label={t("images.resolution")}
              className="mr-2 shrink-0 [&>div]:gap-2 [&>div]:px-0 [&>div]:py-0"
            >
              <EffortSlider
                key={model.id}
                name={t("images.resolution")}
                value={selection.size}
                levels={model.sizes.map((size) => ({ value: size, name: size }))}
                trackWidth={64}
                onChange={(size) =>
                  saveImageSelection({ model: model.id, size }).catch((error: unknown) => {
                    toast.error(String(error))
                  })
                }
              />
            </div>
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator className="shrink-0" />
        <DropdownMenuGroup className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain">
          <DropdownMenuRadioGroup
            className="min-w-0"
            aria-label={t("images.model")}
            value={model.id}
            onValueChange={(value) => {
              const next = models.find((entry) => entry.id === value)
              if (!next) throw new Error("Unknown image model")
              const size = (next.sizes as readonly string[]).includes(selection.size) ? selection.size : next.sizes[0]
              void saveImageSelection({ model: next.id, size }).catch((error: unknown) => toast.error(String(error)))
            }}
          >
            {models.map((entry) => (
              <DropdownMenuRadioItem
                key={entry.id}
                value={entry.id}
                closeOnClick
                className="h-8 min-w-0 gap-2 rounded-md py-0 ps-2 font-normal"
              >
                <ImageModelIcon provider={entry.provider} />
                <span className="min-w-0 truncate">{entry.label}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator className="shrink-0" />
        <DropdownMenuGroup className="shrink-0">
          <DropdownMenuItem
            className="h-9 gap-2 rounded-md px-2 text-sm font-normal"
            onClick={() => {
              void openSettingsWindow("images").catch((error: unknown) => toast.error(String(error)))
            }}
          >
            {t("images.settings")}
            <ExternalLinkIcon className="ml-auto size-4" aria-hidden="true" />
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
