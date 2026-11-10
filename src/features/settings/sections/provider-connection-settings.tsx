import { ChevronDownIcon } from "lucide-react"
import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { InputGroup, InputGroupInput } from "@/components/ui/input-group"
import { Separator } from "@/components/ui/separator"

export function ProviderConnectionSettings({ id, children }: { id: string; children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <>
      <Separator />
      <section className="space-y-4" aria-labelledby={id}>
        <h4 id={id} className="text-sm font-medium">
          {t("provider.connectionSettings")}
        </h4>
        {children}
      </section>
    </>
  )
}

export function ProviderBaseUrl({
  id,
  value,
  placeholder,
  disabled,
  onChange,
  description
}: {
  id: string
  value: string
  placeholder?: string
  disabled?: boolean
  onChange: (value: string) => void
  description: string
}) {
  const { t } = useTranslation()
  return (
    <Collapsible className="space-y-2">
      <CollapsibleTrigger className="group inline-flex items-center gap-1 bg-none! p-0 text-sm leading-snug font-medium">
        {t("provider.baseUrl")}
        <ChevronDownIcon className="size-4 transition-transform group-aria-expanded:rotate-180" aria-hidden="true" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Field className="gap-2">
          <FieldLabel htmlFor={id} className="sr-only">
            {t("provider.baseUrl")}
          </FieldLabel>
          <InputGroup>
            <InputGroupInput
              id={id}
              type="url"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder={placeholder}
              value={value}
              disabled={disabled}
              onChange={(event) => onChange(event.target.value)}
            />
          </InputGroup>
          <FieldDescription className="text-xs">{description}</FieldDescription>
        </Field>
      </CollapsibleContent>
    </Collapsible>
  )
}
