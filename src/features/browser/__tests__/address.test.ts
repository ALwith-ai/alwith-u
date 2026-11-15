import "./language"
import { expect, test } from "vitest"

import { resolveAddress, translationOf } from "../address"

test.each([
  ["example.com", "https://example.com/"],
  [" localhost:5173/app?q=test ", "http://localhost:5173/app?q=test"],
  ["127.0.0.1:3000", "http://127.0.0.1:3000/"],
  ["[::1]:8080", "http://[::1]:8080/"],
  ["app.localhost:5173", "http://app.localhost:5173/"],
  ["https://example.com/path#part", "https://example.com/path#part"],
  ["hello world", "https://www.google.com/search?q=hello%20world"],
  ["", "about:blank"]
])("resolves %s", (input, expected) => expect(resolveAddress(input)).toBe(expected))

test.each(["javascript:alert(1)", "file:///etc/passwd", "https://user:password@example.com"])(
  "rejects unsupported or credential-bearing navigation %s",
  (input) => expect(() => resolveAddress(input)).toThrow()
)

test("the extensions page is the one internal page that can be typed", () => {
  expect(resolveAddress("chrome://extensions")).toBe("chrome://extensions/")
  expect(resolveAddress(" CHROME://EXTENSIONS/ ")).toBe("chrome://extensions/")
  expect(() => resolveAddress("chrome://settings")).toThrow()
  expect(() => resolveAddress("chrome://extensions/../settings")).toThrow()
})

test("the source of a web page is an address a tab may show, and of nothing else", () => {
  expect(resolveAddress("view-source:https://example.com/a")).toBe("view-source:https://example.com/a")
  expect(() => resolveAddress("view-source:file:///etc/passwd")).toThrow()
})

test("a page is translated by handing its address to the translation service in the reader's language", () => {
  expect(translationOf("https://example.com/a?b=1&c=2", "zh-CN")).toBe(
    "https://translate.google.com/translate?sl=auto&tl=zh-CN&u=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1%26c%3D2"
  )
})
