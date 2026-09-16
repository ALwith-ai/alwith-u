import type { ComponentProps } from "react"
import { cn } from "@/lib/utils"

type NavigationStackProps = ({ as?: "div" } & ComponentProps<"div">) | ({ as: "ul" } & ComponentProps<"ul">)

/** 导航栏唯一纵向排列容器：所有同级行之间固定保留 2px 间距。 */
export function NavigationStack(props: NavigationStackProps) {
  if (props.as === "ul") {
    const { as: _as, className, ...listProps } = props
    return <ul className={cn("flex w-full min-w-0 flex-col gap-0.5", className)} {...listProps} />
  }

  const { as: _as, className, ...divProps } = props
  return <div className={cn("flex w-full min-w-0 flex-col gap-0.5", className)} {...divProps} />
}
