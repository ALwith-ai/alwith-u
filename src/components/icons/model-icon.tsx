import { Bot } from "lucide-react"
import type { ComponentType, SVGProps } from "react"

import { PROVIDERS } from "@/lib/providers"
import { cn } from "@/lib/utils"

import { AlwithAccountLogo, AlwithEnterpriseLogo, ChatGPTLogo, MiniMaxLogo, SeedreamLogo } from "./model/provider-logos"

const logos: Record<string, ComponentType<SVGProps<SVGSVGElement>>> = {
  "alwith-account": AlwithAccountLogo,
  "alwith-enterprise": AlwithEnterpriseLogo,
  chatgpt: ChatGPTLogo,
  minimax: MiniMaxLogo,
  seedream: SeedreamLogo
}

type ModelIconProps = SVGProps<SVGSVGElement> & { provider: string }

export function ModelIcon({ provider, className, ...props }: ModelIconProps) {
  const Logo = Object.hasOwn(logos, provider)
    ? logos[provider]
    : (PROVIDERS.find((item) => item.id === provider)?.logo ?? Bot)
  return <Logo aria-hidden="true" {...props} className={cn("size-4 shrink-0", className)} />
}
