interface EnterpriseEventHost {
  account(): string | null
  status(): Promise<unknown>
  refreshModels(): Promise<void>
  failed(reason: "authorization" | "configuration" | "refresh"): void
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
/** Events may remain queued after account changes, including same-user reauthentication. */
export function createEnterpriseEventHandler(host: EnterpriseEventHost) {
  return async (value: unknown): Promise<void> => {
    if (
      !record(value) ||
      typeof value.accountId !== "string" ||
      typeof value.generation !== "number" ||
      !Number.isSafeInteger(value.generation) ||
      value.generation < 0
    )
      return
    if (
      ![
        "enterpriseConfigurationFailed",
        "enterpriseAuthorizationChanged",
        "enterpriseLoginCompleted",
        "enterpriseRenewalStatus",
        "enterpriseEventStreamInterrupted"
      ].includes(String(value.type))
    )
      return
    const account = host.account()
    if (value.accountId !== account) return
    try {
      const status = await host.status()
      if (host.account() !== account || !record(status) || status.generation !== value.generation) return
      if (value.type === "enterpriseConfigurationFailed") {
        host.failed("configuration")
      } else {
        if (value.error || value.type === "enterpriseEventStreamInterrupted") host.failed("authorization")
        await host.refreshModels()
      }
    } catch {
      if (host.account() === account) host.failed("refresh")
    }
  }
}
