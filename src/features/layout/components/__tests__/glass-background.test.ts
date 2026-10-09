import { readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "vitest"

const styles = readFileSync(join(__dirname, "../../../../index.css"), "utf8")

test("the docked navigation leaves native vibrancy visible", () => {
  expect(styles).toMatch(/\[data-slot="sidebar-wrapper"\]\s*\{\s*background-color:\s*transparent;\s*\}/)
  expect(styles).toMatch(/\n\[data-slot="sidebar"\]\s*\{\s*background-color:\s*transparent;\s*\}/)
  expect(styles).not.toMatch(
    /\n\[data-slot="sidebar"\]\s*\{\s*background-color:\s*color-mix\(in srgb, var\(--sidebar\) 90%, transparent\);\s*\}/
  )
})

test("the floating navigation paints a separate surface over the chat", () => {
  expect(styles).toMatch(
    /\[data-sidebar-presentation="floating"\] \[data-slot="sidebar"\]\s*\{\s*background-color:\s*var\(--background\);\s*\}/
  )
})
