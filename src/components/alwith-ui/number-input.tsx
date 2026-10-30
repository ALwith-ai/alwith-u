import { MinusIcon, PlusIcon } from "lucide-react"
import { type ComponentProps, useRef } from "react"
import { useTranslation } from "react-i18next"

import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { cn } from "@/lib/utils"

/** Native numeric editing with larger shadcn step controls. */
export function NumberInput({
  className,
  disabled,
  min,
  max,
  value,
  ...props
}: ComponentProps<typeof InputGroupInput>) {
  const input = useRef<HTMLInputElement>(null)
  const { t } = useTranslation()
  const current = value === "" || value === undefined ? null : Number(value)
  const step = (direction: number) => {
    const node = input.current
    if (!node) throw new Error("Number input is not mounted")
    if (direction > 0) node.stepUp()
    else node.stepDown()
    node.dispatchEvent(new Event("input", { bubbles: true }))
  }
  return (
    <InputGroup className={cn("number-input", className)}>
      <InputGroupInput {...props} ref={input} type="number" value={value} min={min} max={max} disabled={disabled} />
      <InputGroupAddon align="inline-end" className="gap-0 py-0 pe-0.5">
        <InputGroupButton
          size="icon-sm"
          disabled={disabled || (current !== null && min !== undefined && current <= Number(min))}
          aria-label={t("actions.decreaseValue", { name: props["aria-label"] ?? "" })}
          onClick={() => step(-1)}
        >
          <MinusIcon />
        </InputGroupButton>
        <InputGroupButton
          size="icon-sm"
          disabled={disabled || (current !== null && max !== undefined && current >= Number(max))}
          aria-label={t("actions.increaseValue", { name: props["aria-label"] ?? "" })}
          onClick={() => step(1)}
        >
          <PlusIcon />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}
