import { expect, test } from "bun:test"

import { desktopArgs } from "../desktop-build"
import { instanceArguments, instanceConfig, instanceName } from "../desktop-instance"

test("numbered instances use the same identity and port in dev and debug packaging", () => {
  for (const instance of Array.from({ length: 9 }, (_, index) => index + 1)) {
    const config = instanceConfig(instance)
    expect(config.productName).toBe(`ALwith U Dev${instance}`)
    expect(config.identifier).toBe(`ai.alwith.u.dev${instance}`)
    expect(config.build.devUrl).toBe(`http://127.0.0.1:${1400 + instance}`)
    for (const mode of ["dev", "build"]) {
      const args = desktopArgs("darwin", mode, [
        "--instance",
        String(instance),
        ...(mode === "build" ? ["--debug"] : [])
      ])
      expect(args).toContain(JSON.stringify(config))
      expect(args).not.toContain("--instance")
    }
  }
  expect(desktopArgs("darwin", "dev")).toContain(JSON.stringify(instanceConfig(1)))
  expect(() => desktopArgs("darwin", "build", ["--instance", "2"])).toThrow("development builds")
})

test("instance numbers are canonical and cannot silently select another profile", () => {
  for (const value of ["0", "01", "09", "00", "001", "10", "19", "20", "21", "99", "dev1", "-1", "1000", "1.5", ""]) {
    expect(() => instanceArguments(["--instance", value])).toThrow("Instance must")
  }
  expect(instanceName(1)).toBe("Dev1")
  expect(instanceName(9)).toBe("Dev9")
  for (const value of [0, 10, 19, 20, 1.5, NaN]) expect(() => instanceConfig(value)).toThrow("Instance must")
  expect(() => instanceArguments(["--instance", "1", "--instance=2"])).toThrow("once")
  expect(instanceArguments(["--instance=2", "--debug"])).toEqual({ instance: 2, rest: ["--debug"] })
})
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
