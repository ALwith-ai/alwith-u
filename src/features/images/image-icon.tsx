import { ImageIcon as PictureIcon } from "lucide-react"
import type { ComponentProps } from "react"

import { cn } from "@/lib/utils"

/** Match the navigation's Lucide strokes with a smaller frame corner radius. */
export function ImageIcon({ className, ...props }: ComponentProps<typeof PictureIcon>) {
  return <PictureIcon {...props} className={cn("size-4", className)} />
}
