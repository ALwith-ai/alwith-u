import { fileURLToPath } from "node:url"

import { loadEnv } from "vite"

const keys = ["VITE_API_BASE_URL", "VITE_WEB_SSO_BASE_URL"] as const
const root = fileURLToPath(new URL("../../", import.meta.url))

export interface AppEnv {
  apiBaseUrl: string
  webSsoBaseUrl: string
}

export function parseAppEnv(values: Record<string, string | undefined>): AppEnv {
  function endpoint(key: (typeof keys)[number]): string {
    const value = values[key]
    try {
      if (!value || value.trim() !== value) throw new Error()
      const url = new URL(value)
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error()
      return url.href.replace(/\/$/, "")
    } catch {
      throw new Error(`Invalid ${key}: expected an HTTPS URL without credentials, query or fragment`)
    }
  }
  return { apiBaseUrl: endpoint("VITE_API_BASE_URL"), webSsoBaseUrl: endpoint("VITE_WEB_SSO_BASE_URL") }
}

export function loadAppEnv(mode: string): AppEnv {
  if (mode !== "development" && mode !== "production") throw new Error(`Unsupported application environment: ${mode}`)
  // Bun preloads env files. Build-mode files must win over inherited endpoint values.
  const inherited = keys.map((key) => [key, process.env[key]] as const)
  try {
    for (const key of keys) delete process.env[key]
    return parseAppEnv(loadEnv(mode, root, "VITE_"))
  } finally {
    for (const [key, value] of inherited) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}
