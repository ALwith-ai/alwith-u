import minimaxLogo from "@/components/icons/minimax-logo.svg"
import openaiLogo from "@/components/icons/openai-logo.svg"
import volcengineLogo from "@/components/icons/volcengine-logo.svg"
import { cn } from "@/lib/utils"

const logos = { chatgpt: openaiLogo, seedream: volcengineLogo, minimax: minimaxLogo }

/** Provider marks match the regular conversation model catalog. */
export function ImageModelIcon({ provider, className }: { provider: keyof typeof logos; className?: string }) {
  return (
    <img
      src={logos[provider]}
      alt=""
      aria-hidden="true"
      className={cn("size-4 shrink-0", provider === "chatgpt" && "dark:invert", className)}
    />
  )
}
