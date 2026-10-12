import { expect, test } from "vitest"
import { type ProviderSnapshot, gatewayModelId, parseCustomModels, providerGroups } from "../providers"

test("custom model selections use adapter-compatible IDs without colliding with other saved providers", () => {
  expect(gatewayModelId("custom_a", "deepseek-flash")).toBe("gateway:custom-637573746f6d5f61:deepseek-flash")
  expect(gatewayModelId("custom_a-b", "model")).not.toBe(gatewayModelId("custom_a_b", "model"))
  expect(gatewayModelId("deepseek", "deepseek-flash")).toBe("gateway:deepseek:deepseek-flash")
})

test("Desktop-compatible custom model JSON is normalized for the adapter and model picker", () => {
  expect(
    parseCustomModels('[{"label":" Model A ","api_id":" model-a ","contextWindow":128000,"description":"Fast"}]')
  ).toEqual([{ label: "Model A", api_id: "model-a", contextWindow: 128000, description: "Fast" }])
  expect(() => parseCustomModels('[{"label":"A","api_id":"same"},{"label":"B","api_id":"same"}]')).toThrow(
    "Model IDs must be unique"
  )
})

test("configured custom providers become independent model groups", () => {
  const snapshot: ProviderSnapshot = {
    revision: 1,
    appliedRevision: 1,
    status: "applied",
    error: null,
    providers: {},
    customProviders: [
      {
        id: "custom_private",
        name: "Private gateway",
        baseUrl: "https://gateway.example.test/v1",
        models: [{ label: "Model A", api_id: "model-a" }]
      }
    ]
  }
  expect(providerGroups(snapshot)).toEqual([
    {
      id: "custom_private",
      name: "Private gateway",
      models: [{ id: "model-a", label: "Model A" }]
    }
  ])
})
