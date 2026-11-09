import { CropIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"

import { IMAGE_ASPECT_RATIOS, type ImageAspectRatio } from "../dialogs/image-edit"

export type ImageInputAspect = "auto" | ImageAspectRatio

/** The image workflow's aspect control shares the ordinary composer's toolbar. */
export function ImageInputTools({
  value,
  onChange,
  disabled
}: {
  value: ImageInputAspect
  onChange: (value: ImageInputAspect) => void
  disabled: boolean
}) {
  const { t } = useTranslation()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="h-7 rounded-full px-2 text-xs"
            disabled={disabled}
            aria-label={t("chat.inputMode.aspectRatio")}
          />
        }
      >
        <CropIcon className="size-4" />
        {value === "auto" ? t("chat.inputMode.autoAspect") : value}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            if (next !== "auto" && !IMAGE_ASPECT_RATIOS.some((ratio) => ratio.value === next))
              throw new Error("Unknown image aspect ratio")
            onChange(next as ImageInputAspect)
          }}
        >
          <DropdownMenuRadioItem value="auto" closeOnClick>
            {t("chat.inputMode.autoAspect")}
          </DropdownMenuRadioItem>
          {IMAGE_ASPECT_RATIOS.map(({ value }) => (
            <DropdownMenuRadioItem key={value} value={value} closeOnClick>
              {value}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
