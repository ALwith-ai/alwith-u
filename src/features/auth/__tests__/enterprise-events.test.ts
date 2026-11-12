import { expect, test, vi } from "vitest"

import { createEnterpriseEventHandler } from "../enterprise-events"

const event = { type: "enterpriseRenewalStatus", accountId: "alice", generation: 1, error: null }
function fixture() {
  const host = {
    account: () => "alice" as string | null,
    status: vi.fn(async () => ({ generation: 2 })),
    refreshModels: vi.fn(async () => {}),
    failed: vi.fn()
  }
  return { host, handle: createEnterpriseEventHandler(host) }
}
test("same-user events from an earlier enterprise generation are discarded", async () => {
  const { host, handle } = fixture()
  await handle(event)
  expect(host.refreshModels).not.toHaveBeenCalled()
  expect(host.failed).not.toHaveBeenCalled()
})
test("a status request finishing after account replacement has no effects", async () => {
  const { host, handle } = fixture()
  host.status.mockImplementation(async () => {
    host.account = () => "bob"
    return { generation: 1 }
  })
  await handle(event)
  expect(host.refreshModels).not.toHaveBeenCalled()
})
test("legacy ALwith account renewal events cannot trigger a platform credential request", async () => {
  const { host, handle } = fixture()
  await handle({ ...event, generation: 2, type: "enterpriseAccountRefreshRequested", requestId: "request" })
  expect(host.status).not.toHaveBeenCalled()
  expect(host.refreshModels).not.toHaveBeenCalled()
})
test("failed authorization refreshes models so revoked models disappear", async () => {
  const { host, handle } = fixture()
  await handle({ ...event, generation: 2, error: "invalid_grant" })
  expect(host.failed).toHaveBeenCalledWith("authorization")
  expect(host.refreshModels).toHaveBeenCalledOnce()
})
test("gateway session revocation removes managed models immediately", async () => {
  const { host, handle } = fixture()
  await handle({
    ...event,
    type: "enterpriseAuthorizationChanged",
    generation: 2,
    error: "enterprise_authorization_required"
  })
  expect(host.refreshModels).toHaveBeenCalledOnce()
  expect(host.failed).toHaveBeenCalledWith("authorization")
})
test("malformed events are rejected without requesting account state", async () => {
  const { host, handle } = fixture()
  await handle({ ...event, generation: undefined })
  await handle({ ...event, type: "enterpriseAccountRefreshRequested" })
  expect(host.status).not.toHaveBeenCalled()
})
