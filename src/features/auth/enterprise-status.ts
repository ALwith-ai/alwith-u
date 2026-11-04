export interface EnterpriseStatus {
  enabled: boolean
  authorization_status: string
  email?: string
}
export interface EnterpriseRenewal {
  automatic_renewal: boolean
  requires_login: boolean
  error: string | null
}

export function parseEnterpriseRenewal(value: unknown): EnterpriseRenewal {
  if (
    typeof value !== "object" ||
    value === null ||
    !("automatic_renewal" in value) ||
    !("requires_login" in value) ||
    !("error" in value) ||
    typeof value.automatic_renewal !== "boolean" ||
    typeof value.requires_login !== "boolean" ||
    (value.error !== null && typeof value.error !== "string")
  )
    throw new Error("Invalid enterprise renewal response")
  return { automatic_renewal: value.automatic_renewal, requires_login: value.requires_login, error: value.error }
}

export function enterpriseLoginAvailable(status: EnterpriseStatus, renewal: EnterpriseRenewal): boolean {
  return (
    status.enabled &&
    status.authorization_status === "authorized" &&
    renewal.automatic_renewal &&
    !renewal.requires_login
  )
}
