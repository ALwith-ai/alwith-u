import { setTheme as setNativeTheme } from "@tauri-apps/api/app"
import { isTauri } from "@tauri-apps/api/core"
import * as React from "react"

export type Theme = "dark" | "light" | "system"
export type ResolvedTheme = "dark" | "light"

type ThemeProviderState = {
  theme: Theme
  resolvedTheme: ResolvedTheme
  setTheme: (theme: Theme) => void
}

const COLOR_SCHEME_QUERY = "(prefers-color-scheme: dark)"
const THEME_VALUES: Theme[] = ["dark", "light", "system"]
// localStorage is the one store readable before the first paint, which keeps the
// theme from flashing; every other preference lives in the Tauri store.
const STORAGE_KEY = "theme"

const ThemeProviderContext = React.createContext<ThemeProviderState | undefined>(undefined)

function isTheme(value: string | null): value is Theme {
  return value !== null && THEME_VALUES.includes(value as Theme)
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia(COLOR_SCHEME_QUERY).matches ? "dark" : "light"
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    return isTheme(stored) ? stored : "system"
  })
  const [resolvedTheme, setResolvedTheme] = React.useState<ResolvedTheme>(() =>
    theme === "system" ? systemTheme() : theme
  )

  const setTheme = React.useCallback((next: Theme) => {
    localStorage.setItem(STORAGE_KEY, next)
    setThemeState(next)
  }, [])

  // Another window of this app changed the theme: localStorage is shared per origin.
  React.useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setThemeState(isTheme(event.newValue) ? event.newValue : "system")
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  React.useEffect(() => {
    const apply = () => {
      const resolved = theme === "system" ? systemTheme() : theme
      const root = document.documentElement
      root.classList.remove("light", "dark")
      root.classList.add(resolved)
      root.style.colorScheme = resolved
      setResolvedTheme(resolved)
      if (isTauri()) {
        void setNativeTheme(theme === "system" ? null : theme).catch((error: unknown) =>
          console.error("Failed to set native theme", error)
        )
      }
    }
    apply()
    if (theme !== "system") return
    const query = window.matchMedia(COLOR_SCHEME_QUERY)
    query.addEventListener("change", apply)
    return () => query.removeEventListener("change", apply)
  }, [theme])

  const value = React.useMemo(() => ({ theme, resolvedTheme, setTheme }), [theme, resolvedTheme, setTheme])
  return <ThemeProviderContext.Provider value={value}>{children}</ThemeProviderContext.Provider>
}

export function useTheme(): ThemeProviderState {
  const context = React.useContext(ThemeProviderContext)
  if (context === undefined) throw new Error("useTheme must be used within a ThemeProvider")
  return context
}
