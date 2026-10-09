import { afterEach, beforeEach, expect, test } from "bun:test"
import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { installDom } from "@/features/chat/codex/__tests__/dom-environment"
import { initI18n } from "@/lib/i18n"
import { ExtensionSkills } from "../skills/extension-skills"

installDom()
beforeEach(async () => {
  await initI18n("en")
})
afterEach(cleanup)

test("requirements expose actual Codex names and a working management action", async () => {
  let managed = 0
  const view = render(
    <ExtensionSkills
      required={["yup-kb", "missing"]}
      catalog={{
        status: "loaded",
        errors: [],
        skills: [
          {
            name: "finture-bi:yup-kb",
            path: "/plugins/yup/SKILL.md",
            enabled: true,
            description: "",
            scope: "user",
            pluginId: "finture-bi@personal"
          }
        ]
      }}
      onManage={() => {
        managed++
      }}
      onRefresh={() => {}}
    />
  )
  expect(view.getByText("finture-bi:yup-kb")).toBeTruthy()
  expect(view.getByText("Enabled")).toBeTruthy()
  expect(view.getByText("Not installed")).toBeTruthy()
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Manage skills and plugins" })))
  expect(managed).toBe(1)
})

test("partial catalog failures cannot claim a requirement is not installed", () => {
  const view = render(
    <ExtensionSkills
      required={["yup-kb"]}
      catalog={{ status: "loaded", skills: [], errors: [{ path: "/broken/SKILL.md", message: "Invalid metadata" }] }}
      onManage={() => {}}
      onRefresh={() => {}}
    />
  )
  expect(view.queryByText("Not installed")).toBeNull()
  expect(view.getByText("Could not verify")).toBeTruthy()
  expect(view.getByText(/Invalid metadata/)).toBeTruthy()
})

test("failed requests stay distinct from missing skills and offer retry", async () => {
  let retried = 0
  const view = render(
    <ExtensionSkills
      required={["yup-kb"]}
      catalog={{ status: "error", message: "Disconnected" }}
      onManage={() => {}}
      onRefresh={() => {
        retried++
      }}
    />
  )
  expect(view.queryByText("Not installed")).toBeNull()
  expect(view.getByText(/Disconnected/)).toBeTruthy()
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Check again" })))
  expect(retried).toBe(1)
})
