import { afterEach, expect, vi, test } from "vitest"
import * as core from "@tauri-apps/api/core"
import { render, waitFor } from "@testing-library/react"
import { ThemeProvider } from "@/components/theme-provider"
import { initI18n } from "@/lib/i18n"
import { ChatDirectoryContext } from "../../file-actions"
import { CodexMarkdownRenderer } from "../markdown-renderer"

vi.mock("@tauri-apps/api/core", async importOriginal => ({ ...(await importOriginal<object>()) }))

await initI18n("en")
const mounted: Array<ReturnType<typeof render>> = []
const mocks: Array<{ mockRestore(): void }> = []
afterEach(() => {
  for (const view of mounted.splice(0)) view.unmount()
  for (const mock of mocks.splice(0)) mock.mockRestore()
})
function viewOf(text: string, cwd = "/tmp/owner") {
  return (
    <ThemeProvider>
      <ChatDirectoryContext value={cwd}>
        <CodexMarkdownRenderer text={text} />
      </ChatDirectoryContext>
    </ThemeProvider>
  )
}

test("standalone local file links become cards while source references and fenced code keep Markdown rendering", () => {
  const view = render(
    viewOf("[Download report](reports/report.pdf)\n\n[Source](src/app.ts:12)\n\n```text\n[fake](fake.pdf)\n```")
  )
  mounted.push(view)
  expect(view.getByRole("button", { name: "Download report" }).textContent).toContain("report.pdf · PDF")
  expect(view.getByRole("link", { name: "Source" }).getAttribute("href")).toBe("src/app.ts:12")
  expect(view.queryByRole("button", { name: "fake" })).toBeNull()
  expect(view.container.querySelector("code")?.textContent).toContain("[fake](fake.pdf)")
})

test("local image references load from the owning directory and can be saved", async () => {
  const invoke = vi.spyOn(core, "invoke").mockResolvedValue({ data: "png", mimeType: "image/png" })
  mocks.push(invoke)
  const view = render(viewOf("[Portrait](images/portrait%20one.png)"))
  mounted.push(view)
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("chat_read_image", {
      path: "/tmp/owner/images/portrait one.png",
      cwd: "/tmp/owner"
    })
  )
  await waitFor(() =>
    expect(view.container.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,png")
  )
  expect(view.getByRole("button", { name: "Download portrait one.png" })).toBeDefined()
})

test("failed local preview retains an actionable file card and shows the read error", async () => {
  const invoke = vi.spyOn(core, "invoke").mockRejectedValue(new Error("File missing"))
  mocks.push(invoke)
  const view = render(viewOf("![Missing](missing.png)"))
  mounted.push(view)
  await waitFor(() => expect(view.getByRole("alert").textContent).toBe("File missing"))
  expect(view.getByRole("button", { name: "Missing" })).toBeDefined()
})

test("reference definitions survive artifact extraction", () => {
  const view = render(
    viewOf("[Report][report]\n\n[Documentation][docs]\n\n[report]: report.pdf\n[docs]: https://example.com/docs")
  )
  mounted.push(view)
  expect(view.getByRole("button", { name: "Report" })).toBeDefined()
  expect(view.getByRole("link", { name: "Documentation" }).getAttribute("href")).toBe("https://example.com/docs")
})

test("web image links are not read as local files", () => {
  const invoke = vi.spyOn(core, "invoke").mockResolvedValue({})
  mocks.push(invoke)
  const view = render(viewOf("[Web portrait](www.example.com/portrait.png)\n\n![Web image](//example.com/image.png)"))
  mounted.push(view)
  expect(view.queryByRole("button", { name: "Web portrait" })).toBeNull()
  expect(invoke).not.toHaveBeenCalled()
})
