import { readFileSync } from "node:fs"

import { cleanup, render } from "@testing-library/react"
import { afterEach, expect, test } from "vitest"

import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Popover, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipTrigger } from "@/components/ui/tooltip"

afterEach(cleanup)

test("status bar hover styling excludes canvas pagination buttons", () => {
  const view = render(
    <footer className="main-window-statusbar">
      <nav className="canvas-dots">
        <Button variant="ghost">Page 1</Button>
      </nav>
      <Button variant="ghost">Status</Button>
    </footer>
  )
  const stylesheet = readFileSync("src/index.css", "utf8")
  const rule = stylesheet.match(/([^{}]+)\{\s*background-color: var\(--chrome-hover-background\);\s*\}/)
  if (!rule) throw new Error("Missing shared chrome hover rule")
  const overlayRule = stylesheet.match(/([^{}]+)\{\s*background-image: linear-gradient\(/)
  if (!overlayRule) throw new Error("Missing application hover overlay rule")
  for (const hoverRule of [rule, overlayRule]) {
    const selector = hoverRule[1].replaceAll(":hover", ":is(*)")
    expect(view.getByRole("button", { name: "Page 1" }).matches(selector)).toBe(false)
    expect(view.getByRole("button", { name: "Status" }).matches(selector)).toBe(true)
  }
})

test("sidebar hover styling reaches buttons composed with tooltip and menu triggers", () => {
  const view = render(
    <div className="main-sidebar-panel">
      <Button variant="ghost">Back</Button>
      <Tooltip>
        <TooltipTrigger render={<Button variant="ghost" />}>Search</TooltipTrigger>
      </Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" />}>Account</DropdownMenuTrigger>
      </DropdownMenu>
      <Popover>
        <PopoverTrigger render={<Button variant="ghost" />}>Projects</PopoverTrigger>
      </Popover>
    </div>
  )
  const stylesheet = readFileSync("src/index.css", "utf8")
  const rule = stylesheet.match(/([^{}]+)\{\s*background-color: var\(--chrome-hover-background\);\s*\}/)
  if (!rule) throw new Error("Missing shared chrome hover rule")
  // Check the real composed DOM against the stylesheet's selector without requiring a pointer in jsdom.
  // Keep nested :is() branches valid while treating pointer hover as active.
  const selector = rule[1].replaceAll(":hover", ":is(*)")
  for (const name of ["Back", "Search", "Account", "Projects"]) {
    expect(view.getByRole("button", { name }).matches(selector), name).toBe(true)
  }
})
