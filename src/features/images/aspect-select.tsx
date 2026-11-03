import { CropIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { IMAGE_REQUEST_ASPECTS, type ImageRequestAspect } from "@/agent/image-request"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"

export function ImageAspectSelect({
  value,
  onChange,
  disabled
}: {
  value: ImageRequestAspect
  onChange: (value: ImageRequestAspect) => void
  disabled: boolean
}) {
  const { t } = useTranslation()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="sm" disabled={disabled} aria-label={t("images.aspectRatio")} />}
      >
        <CropIcon className="size-4" />
        {value === "auto" ? t("images.autoAspect") : value}
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuRadioGroup value={value} onValueChange={(value) => onChange(value as ImageRequestAspect)}>
          {IMAGE_REQUEST_ASPECTS.map((aspect) => (
            <DropdownMenuRadioItem key={aspect} value={aspect}>
              {aspect === "auto" ? t("images.autoAspect") : aspect}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
