import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach, expect, test } from "bun:test"
import { useState } from "react"
import type { ThreadSummary } from "@/agent/client"
import { ThemeProvider } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import { installDom } from "@/features/chat/codex/__tests__/dom-environment"
import { client } from "@/lib/client"
import { initI18n } from "@/lib/i18n"
import { CommandPalette } from "../command-palette"

installDom()
await initI18n("en")

const originalState = client.state
afterEach(() => {
  cleanup()
  client.store.setState(originalState, true)
})

test("search opens with its command context and closes after selecting the explicit session", async () => {
  const thread: ThreadSummary = {
    sessionId: "sidebar-search-result",
    cwd: "/tmp/sidebar-project",
    title: "Floating layout review",
    updatedAt: null,
    archived: false
  }
  client.store.setState({ threads: [thread] })
  const selected: ThreadSummary[] = []
  function Harness() {
    const [open, setOpen] = useState(false)
    return (
      <ThemeProvider>
        <Button onClick={() => setOpen(true)}>Search</Button>
        <CommandPalette
          open={open}
          onOpenChange={setOpen}
          onNewChat={() => {}}
          onOpenSettings={() => {}}
          onOpenPlugins={() => {}}
          onOpenHotkeys={() => {}}
          onSelect={value => selected.push(value)}
        />
      </ThemeProvider>
    )
  }
  const view = render(<Harness />)
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Search" })))
  expect(view.getByRole("combobox")).toBeTruthy()
  await act(async () => fireEvent.click(view.getByRole("option", { name: /Floating layout review/ })))
  expect(selected).toEqual([thread])
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull())
})
