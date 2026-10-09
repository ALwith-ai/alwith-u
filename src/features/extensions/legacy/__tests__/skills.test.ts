import { expect, test } from "bun:test"
import { legacyMessageSkills } from "../adapters"
import { assertAvailableSkills, inspectRequiredSkills } from "../../chat/skills"

test("business prompts require enabled Codex skills and reject Desktop's old catalog", () => {
  const names = legacyMessageSkills("yup-kb", "按 yup-kb skill §6 分析，参考 bi-monthly-report skill")
  expect(names).toEqual(["yup-kb"])
  expect(() =>
    assertAvailableSkills(
      ["bi-monthly-report"],
      [{ name: "yup-kb", enabled: true, path: "/home/.codex/skills/yup-kb/SKILL.md" }]
    )
  ).toThrow("bi-monthly-report")
  expect(() =>
    assertAvailableSkills(["yup-kb"], [{ name: "yup-kb", enabled: false, path: "/home/.codex/skills/yup-kb/SKILL.md" }])
  ).toThrow("yup-kb")
  expect(() =>
    assertAvailableSkills(["yup-kb"], [{ name: "yup-kb", enabled: true, path: "/home/.alwith/skills/yup-kb/SKILL.md" }])
  ).toThrow("yup-kb")
  expect(() =>
    assertAvailableSkills(["yup-kb"], [{ name: "yup-kb", enabled: true, path: "/home/.codex/skills/yup-kb/SKILL.md" }])
  ).not.toThrow()
  expect(legacyMessageSkills("yup-kb", "analyze this data")).toEqual([])
})

test("generic extensions do not inherit business skill requirements", () => {
  expect(legacyMessageSkills("other", "yup-kb skill")).toEqual([])
})

test("accepts enabled namespaced plugin skills without accepting ambiguous matches", () => {
  const skills = [
    { name: "finture-bi:bi-add-metric", enabled: true, path: "/plugins/finture-bi/skills/bi-add-metric/SKILL.md" }
  ]
  expect(() => assertAvailableSkills(["bi-add-metric"], skills)).not.toThrow()
  expect(() =>
    assertAvailableSkills(
      ["bi-add-metric"],
      [...skills, { name: "other:bi-add-metric", enabled: true, path: "/plugins/other/skills/bi-add-metric/SKILL.md" }]
    )
  ).toThrow("多个")
  expect(() => assertAvailableSkills(["bi-add-metric"], [{ ...skills[0], enabled: false }])).toThrow("bi-add-metric")
})

test("duplicate catalog rows for the same file do not prevent sending", () => {
  const skill = { name: "finture-bi:yup-kb", enabled: true, path: "/plugins/yup-kb/SKILL.md" }
  expect(assertAvailableSkills(["yup-kb"], [skill, { ...skill }])).toEqual(["finture-bi:yup-kb"])
})

test("inspection distinguishes absent, disabled, ambiguous and enabled requirements", () => {
  const skills = [
    { name: "disabled", enabled: false, path: "/codex/disabled/SKILL.md" },
    { name: "one:ambiguous", enabled: true, path: "/one/SKILL.md" },
    { name: "two:ambiguous", enabled: true, path: "/two/SKILL.md" },
    { name: "plugin:enabled", enabled: true, path: "/enabled/SKILL.md" },
    { name: "enabled", enabled: false, path: "/disabled-copy/SKILL.md" },
    { name: "old", enabled: true, path: "/home/.alwith/skills/old/SKILL.md" }
  ]
  expect(inspectRequiredSkills(["missing", "disabled", "ambiguous", "enabled", "old"], skills)).toEqual([
    { name: "missing", status: "missing" },
    { name: "disabled", status: "disabled" },
    { name: "ambiguous", status: "ambiguous" },
    { name: "enabled", status: "enabled", resolvedName: "plugin:enabled" },
    { name: "old", status: "missing" }
  ])
})
