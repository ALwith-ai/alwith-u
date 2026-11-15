import { expect, test } from "bun:test"
import { desktopArgs } from "../desktop-build"
test("macOS development allows restart switching; production only builds CEF", () => {
  expect(desktopArgs("darwin", "dev")).toContain("dev-backends,hasgard-testing")
  expect(desktopArgs("darwin", "build")).toContain("experimental-cef")
})
test("Windows always builds Wry without default CEF features", () => {
  for (const mode of ["dev", "build"]) {
    const args = desktopArgs("win32", mode)
    expect(args.slice(args.indexOf("--"))).toContain("--no-default-features")
    expect(args.join(" ")).toContain("runtime-wry")
    expect(args.join(" ")).not.toContain("cef")
  }
  expect(() => desktopArgs("linux", "build")).toThrow("Only macOS and Windows")
  expect(() => desktopArgs("win32", "build", ["--features=experimental-cef"])).toThrow("policy")
})
