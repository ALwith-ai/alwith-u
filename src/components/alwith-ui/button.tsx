import type { ComponentProps } from "react"

import { Button as BaseButton } from "@/components/ui/button"

import { ShortcutTooltip } from "./shortcut-hint"

/** Compose shortcut hints without changing the base button appearance. */
export function Button({
  className,
  variant = "default",
  shortcut,
  title,
  ...props
}: ComponentProps<typeof BaseButton> & { shortcut?: string }) {
  const button = (
    <BaseButton
      {...props}
      title={shortcut === undefined ? title : undefined}
      variant={variant}
      className={className}
    />
  )
  if (shortcut === undefined) return button
  const label = title ?? props["aria-label"]
  if (label === undefined) throw new Error("Shortcut buttons require a label")
  return (
    <ShortcutTooltip label={label} shortcut={shortcut}>
      {button}
    </ShortcutTooltip>
  )
}
