import type { LoginResponse } from "@alwith/module-auth"

/** Validate the server boundary before persisting any credentials. */
export function assertActiveLogin(value: unknown): asserts value is LoginResponse {
  if (!value || typeof value !== "object") throw new Error("Invalid ALwith login response")
  if ("status" in value && value.status !== undefined && value.status !== "ACTIVE") {
    if (value.status === "WAITLISTED" || value.status === "DISABLED") throw new Error(value.status)
    throw new Error("Invalid ALwith account status")
  }
  for (const key of ["user_uuid", "nickname", "login_email", "access_token", "refresh_token"] as const) {
    if (!(key in value) || typeof value[key as keyof typeof value] !== "string")
      throw new Error("Invalid ALwith login response")
  }
  const response = value as LoginResponse
  if (!response.user_uuid || !response.login_email || !response.access_token || !response.refresh_token)
    throw new Error("Incomplete ALwith login response")
}
