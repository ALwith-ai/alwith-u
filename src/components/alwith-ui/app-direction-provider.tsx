import { DirectionProvider } from "@base-ui/react/direction-provider"
import { type ReactNode, useEffect } from "react"
import { useTranslation } from "react-i18next"

export function AppDirectionProvider({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation()
  const language = i18n.language
  const direction = i18n.dir(language)

  useEffect(() => {
    document.documentElement.lang = language
    document.documentElement.dir = direction
  }, [direction, language])

  return <DirectionProvider direction={direction}>{children}</DirectionProvider>
}
