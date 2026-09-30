import type { ComponentProps } from "react"
import { cn } from "@/lib/utils"

type NavigationStackProps = ({ as?: "div" } & ComponentProps<"div">) | ({ as: "ul" } & ComponentProps<"ul">)

/** Shared vertical navigation container with a fixed 2px gap between all sibling rows. */
export function NavigationStack(props: NavigationStackProps) {
  if (props.as === "ul") {
    const { as: _as, className, ...listProps } = props
    return <ul className={cn("flex w-full min-w-0 flex-col gap-0.5", className)} {...listProps} />
  }

  const { as: _as, className, ...divProps } = props
  return <div className={cn("flex w-full min-w-0 flex-col gap-0.5", className)} {...divProps} />
}
