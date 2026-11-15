import { ModelIcon as SharedModelIcon } from "@alwith/module-chat/desktop"
import type { SVGProps } from "react"

import { cn } from "@/lib/utils"

import { AlwithEnterpriseLogo } from "./model/provider-logos"

type ModelIconProps = SVGProps<SVGSVGElement> & { provider: string }

/** The shared model marks plus U's enterprise mark. */
export function ModelIcon({ provider, className, ...props }: ModelIconProps) {
  if (provider === "alwith-enterprise")
    return <AlwithEnterpriseLogo aria-hidden="true" {...props} className={cn("size-4 shrink-0", className)} />
  return <SharedModelIcon provider={provider} {...props} className={className} />
}
