import { useTranslation } from "react-i18next"

import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"

import { useInputMode } from "./composer/input-mode"

export function ChatWelcome() {
  const { t } = useTranslation()
  const inputMode = useInputMode()
  const title = inputMode ? `chat.inputMode.welcome.${inputMode.mode}.title` : "welcome.title"
  const description = inputMode ? `chat.inputMode.welcome.${inputMode.mode}.description` : "welcome.description"
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyTitle className="text-[28px] font-normal">{t(title)}</EmptyTitle>
        <EmptyDescription>{t(description)}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
