import { renderHook } from "@testing-library/react"
import { expect, test } from "vitest"

import { ThemeProvider } from "@/components/theme-provider"
import { initI18n } from "@/lib/i18n"

import { useChatHost } from "../chat-host"

await initI18n("en")

test("leaves turn error presentation to the shared chat package", () => {
  const { result } = renderHook(() => useChatHost(), { wrapper: ThemeProvider })
  expect(result.current.turnErrorAction).toBeUndefined()
})
