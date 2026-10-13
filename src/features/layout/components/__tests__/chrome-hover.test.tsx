import { readFileSync } from "node:fs"
import { cleanup, render } from "@testing-library/react"
import { afterEach, expect, test } from "vitest"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Popover, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipTrigger } from "@/components/ui/tooltip"

afterEach(cleanup)

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
  const selector = rule[1].replaceAll(":hover", "")
  for (const name of ["Back", "Search", "Account", "Projects"]) {
    expect(view.getByRole("button", { name }).matches(selector), name).toBe(true)
  }
})
