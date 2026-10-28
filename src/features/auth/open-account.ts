import { openUrl } from "@tauri-apps/plugin-opener"

import { appEnv } from "@/lib/app-env"

import { authClient } from "./store"

/** The existing account SSO route opens in the system browser. */
export async function openPlatformAccount(): Promise<void> {
  const url = new URL("/account", appEnv.webSsoBaseUrl)
  let otp: string | null = null
  try {
    otp = (await authClient.getSsoOtp()).otp
  } catch {
    /* The account page can also sign in interactively. */
  }
  if (otp !== null) {
    url.pathname = "/sso"
    url.searchParams.set("otp", otp)
    url.searchParams.set("redirect", "/account")
  }
  await openUrl(url.href)
}
