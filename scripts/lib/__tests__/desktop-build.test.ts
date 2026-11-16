import { expect, test } from "bun:test"

import { desktopArgs } from "../desktop-build"
test("macOS development allows restart switching; production only builds CEF", () => {
  expect(desktopArgs("darwin", "dev")).toContain("dev-backends,hasgard-testing")
  expect(desktopArgs("darwin", "build")).toContain("experimental-cef,tauri/custom-protocol")
})
test("debug packaging keeps the development identity and includes the full native feature set", () => {
  const args = desktopArgs("darwin", "build", ["--debug"])
  expect(args).toContain("dev-backends,hasgard-testing,tauri/custom-protocol")
  expect(args).toContain("src-tauri/tauri.dev-instance.conf.json")
  expect(args).toContain("--debug")
  expect(desktopArgs("darwin", "build")).not.toContain("src-tauri/tauri.dev-instance.conf.json")
  expect(desktopArgs("win32", "build", ["--debug"])).toContain("dev-backends,hasgard-testing,tauri/custom-protocol")
})
test("Windows uses the same CEF and development backend policy as macOS", () => {
  for (const mode of ["dev", "build"]) expect(desktopArgs("win32", mode)).toEqual(desktopArgs("darwin", mode))
  expect(desktopArgs("win32", "dev")).toContain("dev-backends,hasgard-testing")
  expect(desktopArgs("win32", "build")).toContain("experimental-cef,tauri/custom-protocol")
  expect(() => desktopArgs("linux", "build")).toThrow("Only macOS and Windows")
  expect(() => desktopArgs("win32", "build", ["--features=experimental-cef"])).toThrow("policy")
})
