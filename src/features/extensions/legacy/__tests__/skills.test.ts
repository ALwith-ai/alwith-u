import { expect, test } from "bun:test"
import { assertLegacySkills } from "../skills"
import { legacyMessageSkills } from "../adapters"

test("business prompts require enabled Codex skills and reject Desktop's old catalog", () => {
  const names = legacyMessageSkills("yup-kb", "按 yup-kb skill §6 分析，参考 bi-monthly-report skill")
  expect(names).toEqual(["yup-kb"])
  expect(() =>
    assertLegacySkills(
      ["bi-monthly-report"],
      [{ name: "yup-kb", enabled: true, path: "/home/.codex/skills/yup-kb/SKILL.md" }]
    )
  ).toThrow("bi-monthly-report")
  expect(() =>
    assertLegacySkills(["yup-kb"], [{ name: "yup-kb", enabled: false, path: "/home/.codex/skills/yup-kb/SKILL.md" }])
  ).toThrow("yup-kb")
  expect(() =>
    assertLegacySkills(["yup-kb"], [{ name: "yup-kb", enabled: true, path: "/home/.alwith/skills/yup-kb/SKILL.md" }])
  ).toThrow("yup-kb")
  expect(() =>
    assertLegacySkills(["yup-kb"], [{ name: "yup-kb", enabled: true, path: "/home/.codex/skills/yup-kb/SKILL.md" }])
  ).not.toThrow()
  expect(legacyMessageSkills("yup-kb", "analyze this data")).toEqual([])
})

test("generic extensions do not inherit business skill requirements", () => {
  expect(legacyMessageSkills("other", "yup-kb skill")).toEqual([])
})
