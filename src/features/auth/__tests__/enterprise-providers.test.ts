import { gatewayModelId, type ProviderSnapshot } from "@alwith/module-chat/settings"
import { expect, test } from "vitest"

import { enterpriseCatalog, isEnterpriseModel, projectEnterpriseProviders } from "../enterprise-providers"

const provider = {
  id: "custom_alwith_enterprise_account",
  name: "Company",
  baseUrl: "https://issued-gateway.test",
  models: [{ api_id: "issued/model", label: "Issued" }]
}
const snapshot = (): ProviderSnapshot => ({
  revision: 1,
  appliedRevision: 1,
  status: "applied",
  error: null,
  providers: {},
  customProviders: [{ ...provider, id: "custom_personal" }]
})

test("native enterprise metadata is exposed as account models alongside personal providers", () => {
  const result = projectEnterpriseProviders(snapshot(), provider)
  expect(result.customProviders.map((p) => p.id)).toEqual(["custom_personal"])
  expect(result.managedProviders).toEqual([provider])
  expect(projectEnterpriseProviders(snapshot(), null).managedProviders).toEqual([])
  expect(isEnterpriseModel(gatewayModelId(provider.id, "issued/model"))).toBe(true)
  expect(isEnterpriseModel(gatewayModelId("custom_personal", "issued/model"))).toBe(false)
  expect(isEnterpriseModel("gateway:finture-enterprise:issued%2Fmodel")).toBe(true)
})

test("the webview catalog carries API-issued metadata and rejects credentials", () => {
  expect(enterpriseCatalog(provider)).toEqual(provider)
  expect(enterpriseCatalog(null)).toBeNull()
  expect(() => enterpriseCatalog({ ...provider, apiKey: "secret" })).toThrow()
})

test("cached enterprise providers are hidden when native has no authorized catalog", () => {
  const saved = snapshot()
  saved.customProviders.push(provider)
  expect(projectEnterpriseProviders(saved, null).customProviders.map((p) => p.id)).toEqual(["custom_personal"])
  expect(projectEnterpriseProviders(saved, null).managedProviders).toEqual([])
})
