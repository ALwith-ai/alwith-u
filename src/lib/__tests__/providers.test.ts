import { expect, test } from "vitest"

import {
  gatewayModelId,
  isAccountModel,
  parseCustomModels,
  providerGroups,
  PROVIDERS,
  type ProviderSnapshot,
  resolveSessionModel
} from "../providers"

test("Desktop defaults prefer configured providers and leave native defaults to the engine", () => {
  const snapshot: ProviderSnapshot = {
    revision: 1,
    appliedRevision: 1,
    status: "applied",
    error: null,
    providers: {},
    customProviders: []
  }
  expect(resolveSessionModel(null, snapshot)).toBeNull()
  expect(resolveSessionModel("gateway:removed:model", snapshot)).toBeNull()
  snapshot.customProviders.push({
    id: "custom_private",
    name: "Private",
    baseUrl: "https://gateway.example.test/v1",
    models: [
      { api_id: "model-a", label: "A" },
      { api_id: "model-b", label: "B" }
    ]
  })
  expect(resolveSessionModel(null, snapshot)).toBe(gatewayModelId("custom_private", "model-a"))
  expect(resolveSessionModel("gateway:removed:model", snapshot)).toBe(gatewayModelId("custom_private", "model-a"))
  expect(resolveSessionModel(gatewayModelId("custom_private", "model-b"), snapshot)).toBe(
    gatewayModelId("custom_private", "model-b")
  )
  expect(resolveSessionModel("gpt-6-astra", snapshot)).toBe("gpt-6-astra")
})

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

test("an explicitly selected unavailable account model never falls back to another provider", () => {
  const snapshot: ProviderSnapshot = {
    revision: 0,
    appliedRevision: 0,
    providers: {},
    customProviders: [],
    status: "applied",
    error: null
  }
  expect(() => resolveSessionModel("gateway:litellm:account-model", snapshot)).toThrow(/unavailable/i)
})

test("account-managed models keep their own group and can be selected explicitly", () => {
  const snapshot: ProviderSnapshot = {
    revision: 1,
    appliedRevision: 1,
    status: "applied",
    error: null,
    providers: {},
    customProviders: [],
    managedProviders: [
      {
        id: "litellm",
        name: "ALwith",
        baseUrl: "https://gateway.test/v1",
        models: [{ api_id: "ds/pro", label: "DS Pro" }]
      }
    ]
  }
  expect(providerGroups(snapshot)).toEqual([
    { id: "litellm", name: "ALwith", models: [{ id: "ds/pro", label: "DS Pro" }] }
  ])
  expect(resolveSessionModel("gateway:litellm:ds%2Fpro", snapshot)).toBe("gateway:litellm:ds%2Fpro")
})

test("account-sourced providers and Anthropic are excluded from manual key configuration", () => {
  expect(PROVIDERS.map((provider) => provider.id)).toEqual(["deepseek", "openrouter", "qwen", "xai"])
  expect(
    providerGroups({
      revision: 0,
      appliedRevision: 0,
      status: "applied",
      error: null,
      providers: {},
      customProviders: []
    })
  ).toEqual([])
})

test("account model classification follows the catalog source and exact provider ID", () => {
  expect(isAccountModel("gateway:litellm:model")).toBe(true)
  expect(isAccountModel("gateway:finture-enterprise:company-model")).toBe(true)
  expect(isAccountModel("gateway:finture-enterprise-other:company-model")).toBe(false)
  expect(isAccountModel("gateway:litellm-other:model")).toBe(false)
  expect(isAccountModel("gateway:deepseek:deepseek-flash")).toBe(false)
  expect(isAccountModel("gpt-6-sol")).toBe(false)
  expect(isAccountModel(null)).toBe(false)
})

test.each(["gateway:litellm:old", "gateway:finture-enterprise:old"])(
  "new drafts can replace the unavailable saved account model %s",
  (model) => {
    const snapshot: ProviderSnapshot = {
      revision: 2,
      appliedRevision: 2,
      status: "applied",
      error: null,
      providers: {},
      customProviders: []
    }
    expect(resolveSessionModel(model, snapshot, "draft")).toBeNull()
    snapshot.providers.deepseek = { configured: true, region: null, base_url: null }
    expect(resolveSessionModel(model, snapshot, "draft")).toBe(
      gatewayModelId("deepseek", PROVIDERS.find((provider) => provider.id === "deepseek")!.models[0]!.id)
    )
    expect(() => resolveSessionModel(model, snapshot)).toThrow(/unavailable/i)
  }
)

test("a failed custom provider snapshot preserves the explicitly selected native model", () => {
  const snapshot: ProviderSnapshot = {
    revision: 51,
    appliedRevision: null,
    status: "failed",
    error: "Provider My GLM gateway (custom_broken) could not apply (-32602)",
    providers: {},
    customProviders: [{
      id: "custom_broken",
      name: "My GLM gateway",
      baseUrl: "https://gateway.example.test/v1",
      models: [{ api_id: "glm-5", label: "GLM 5" }]
    }]
  }
  expect(resolveSessionModel("gpt-6.1-sol", snapshot, "session")).toBe("gpt-6.1-sol")
  expect(resolveSessionModel("gpt-6.1-sol", snapshot, "draft")).toBe("gpt-6.1-sol")
})
