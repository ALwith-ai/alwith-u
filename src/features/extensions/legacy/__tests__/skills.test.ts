import { expect, test } from "bun:test"
import { requiredLegacySkills, assertLegacySkills } from "../skills"

test("business prompts require enabled Codex skills and reject Desktop's old catalog", () => {
  const names = requiredLegacySkills("按 yup-kb skill §6 分析，参考 bi-monthly-report skill")
  expect(names).toEqual(["bi-monthly-report", "yup-kb"])
  expect(() =>
    assertLegacySkills(names, [{ name: "yup-kb", enabled: true, path: "/home/.codex/skills/yup-kb/SKILL.md" }])
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
  expect(requiredLegacySkills("analyze this data")).toEqual([])
})
