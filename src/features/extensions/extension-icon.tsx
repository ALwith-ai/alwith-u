import { parseManifestIcon } from "@alwith/module-extension"
import { BlocksIcon } from "lucide-react"
import { type ReactNode, useState } from "react"

import { EXTENSION_ICONS } from "./extension-icons"

export function ExtensionIcon({ src, size = "list" }: { src?: string; size?: "list" | "navigation" }): ReactNode {
  const [failed, setFailed] = useState(false)
  const icon = src ? parseManifestIcon(src) : undefined
  if (icon?.type === "lucide") {
    const Icon = EXTENSION_ICONS[icon.name]
    return <Icon aria-hidden="true" className={size === "navigation" ? "size-4" : "size-8 text-muted-foreground"} />
  }
  return src && !failed ? (
    <img
      src={src}
      alt=""
      className={
        size === "navigation" ? "size-4 shrink-0 rounded-sm object-contain" : "size-10 rounded-sm object-contain"
      }
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  ) : (
    <BlocksIcon aria-hidden="true" className={size === "navigation" ? "size-4" : "size-5 text-muted-foreground"} />
  )
}
