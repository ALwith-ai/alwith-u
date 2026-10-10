import type { DriveController, DriveRequest, DriveResponse, RootInfo, Snapshot } from "@alwith/module-drive"
import { type DriveControls, type DriveHost, DrivePanel, DriveSharing } from "@alwith/module-drive/react"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

const root: RootInfo = {
  projectId: 1,
  projectKey: "docs",
  name: "Library",
  kind: "MATERIAL",
  scope: "PERSONAL",
  deptName: null,
  drivePath: "My space/Library",
  node: "PERSONAL",
  container: "MATERIAL",
  nodePath: "My space",
  skillsPath: null,
  syncEnabled: true,
  canWrite: true,
  cloudOnly: false,
  cursor: "1",
  pinned: false,
  departmentId: null,
  ownerId: null,
  isMine: true,
  localPath: "/drive/library",
  selected: true
}
const controls: DriveControls = {
  Button: ({ variant: _variant, size: _size, ...props }) => <button {...props} />,
  Input: props => <input {...props} />,
  Select: ({ options, onValueChange, ...props }) => (
    <select {...props} onChange={event => onValueChange(event.target.value)}>
      {options.map(option => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
  Dialog: ({ open, title, description, children }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        <h2>{title}</h2>
        <p>{description}</p>
        {children}
      </div>
    ) : null,
  Menu: ({ label, items }) => (
    <details>
      <summary>{label}</summary>
      {items.map(item => (
        <button type="button" key={item.label} disabled={item.disabled} onClick={item.onSelect}>
          {item.label}
        </button>
      ))}
    </details>
  ),
  ContextMenu: ({ children }) => <>{children}</>
}
function fixture(
  overrides: Partial<Snapshot> = {},
  respond?: (request: DriveRequest) => Promise<DriveResponse>
): { controller: DriveController; host: DriveHost; requests: DriveRequest[] } {
  const snapshot: Snapshot = {
    version: 1,
    generation: 1,
    sequence: 0,
    configured: true,
    running: true,
    baseUrl: "https://api.example.test",
    localRoot: "/drive",
    webBaseUrl: "https://web.example.test",
    status: null,
    roots: [root],
    pendingDeletes: [],
    files: [],
    projects: [],
    error: null,
    ...overrides
  }
  const state = { connected: true, snapshot, error: null }
  const requests: DriveRequest[] = []
  const controller: DriveController = {
    getSnapshot: () => state,
    subscribe: () => () => {},
    attach: async () => {},
    refresh: async () => {},
    dispose: () => {},
    request: async request => {
      requests.push(request)
      if (request.type === "ownershipGuard")
        return {
          type: "ownershipGuard",
          data: { unknownPersonalRoots: 0, threshold: 10, syncAllPersonal: false, active: false }
        }
      if (respond) return respond(request)
      if (request.type === "shared") return { type: "shared", data: [] }
      throw new Error(`Unexpected request: ${request.type}`)
    }
  }
  const host: DriveHost = {
    readDirectory: async () => [],
    pathExists: async () => true,
    onOpenEntry: vi.fn(async () => {}),
    onRevealPath: vi.fn(async () => {}),
    onOpenExternal: vi.fn(async () => {}),
    pinnedDocs: [],
    onPinnedDocsChange: vi.fn(async () => {}),
    onCondense: vi.fn(async () => {})
  }
  return { controller, host, requests }
}
describe("shared Desktop Drive UI", () => {
  it("opens a shared file by its refreshed exact path, never its project as a file", async () => {
    const f = fixture({}, async request => {
      if (request.type === "shared")
        return {
          type: "shared",
          data: [
            {
              resourceType: "FILE",
              resourceId: 42,
              name: "Quarterly report",
              projectId: 1,
              level: "VIEW",
              localPath: null
            }
          ]
        }
      if (request.type === "land") return { type: "root", data: root }
      if (request.type === "localPath") return { type: "path", data: "/drive/library/reports/q1.md" }
      throw new Error(`Unexpected request: ${request.type}`)
    })
    render(
      <DrivePanel
        {...f}
        controls={controls}
        mode="launcher"
        onOpenProject={async () => {}}
        confirm={async () => true}
      />
    )
    fireEvent.click(await screen.findByRole("button", { name: /Quarterly report/ }))
    await waitFor(() =>
      expect(f.host.onOpenEntry).toHaveBeenCalledWith({ path: "/drive/library/reports/q1.md", isDirectory: false })
    )
    expect(f.host.onOpenEntry).not.toHaveBeenCalledWith({ path: root.localPath, isDirectory: false })
  })
  it("opens an unlisted shared file on its exact web route", async () => {
    const f = fixture({}, async request => {
      if (request.type === "shared")
        return {
          type: "shared",
          data: [{ resourceType: "FILE", resourceId: "file/42", name: "Remote report", projectId: 999, level: "VIEW" }]
        }
      throw new Error(`Unexpected request: ${request.type}`)
    })
    render(
      <DrivePanel
        {...f}
        controls={controls}
        mode="launcher"
        onOpenProject={async () => {}}
        confirm={async () => true}
      />
    )
    fireEvent.click(await screen.findByRole("button", { name: /Remote report/ }))
    await waitFor(() => expect(f.host.onOpenExternal).toHaveBeenCalledWith("https://web.example.test/file/file%2F42"))
    expect(f.requests.some(request => request.type === "land")).toBe(false)
  })
  it("creates a departmental knowledge project using labels and original opaque ids", async () => {
    const f = fixture({}, async request => {
      if (request.type === "shared") return { type: "shared", data: [] }
      if (request.type === "templates")
        return { type: "templates", data: [{ id: "90071992547409999", name: "Research", kind: "KNOWLEDGE" }] }
      if (request.type === "departments")
        return { type: "departments", data: [{ id: "department-a", name: "研发/基础架构" }] }
      if (request.type === "createProject") return { type: "root", data: root }
      throw new Error(`Unexpected request: ${request.type}`)
    })
    await act(async () =>
      render(
        <DrivePanel
          {...f}
          controls={controls}
          locale="zh-CN"
          mode="launcher"
          onOpenProject={async () => {}}
          confirm={async () => true}
        />
      )
    )
    fireEvent.click(screen.getByRole("button", { name: "新建项目" }))
    await screen.findByRole("option", { name: /Research/ })
    const selects = screen.getAllByRole("combobox")
    const scopeSelect = selects[0]
    if (!scopeSelect) throw new Error("Project scope control is missing")
    fireEvent.change(scopeSelect, { target: { value: "DEPT" } })
    expect(await screen.findByRole("option", { name: "研发/基础架构" })).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText("项目名称"), { target: { value: "New report" } })
    fireEvent.click(screen.getByRole("button", { name: "创建" }))
    await waitFor(() =>
      expect(f.requests).toContainEqual({
        type: "createProject",
        request: {
          templateId: "90071992547409999",
          name: "New report",
          scope: "DEPT",
          departmentId: "department-a",
          topicId: null
        }
      })
    )
  })
})

describe("shared permission navigation", () => {
  it("navigates inherited permission sources and returns to the original target", async () => {
    const f = fixture({}, async request => {
      if (request.type === "grantTarget") return { type: "grantTarget", data: { kind: "FILE", id: 42 } }
      if (request.type === "grants")
        return request.target.kind === "FILE"
          ? {
              type: "grants",
              data: {
                callerLevel: "VIEW",
                grants: [
                  {
                    subjectType: "USER",
                    subjectId: 7,
                    subjectDisplay: "Alice",
                    level: "VIEW",
                    inherited: true,
                    source: "FOLDER",
                    sourceResourceId: 8,
                    sourceDisplay: "Reports",
                    editable: false
                  }
                ]
              }
            }
          : { type: "grants", data: { callerLevel: "MANAGE", grants: [] } }
      throw new Error(`Unexpected request: ${request.type}`)
    })
    render(
      <DriveSharing
        controller={f.controller}
        controls={controls}
        path="/drive/library/report.md"
        confirm={async () => true}
      />
    )
    fireEvent.click(await screen.findByRole("button", { name: "From Reports" }))
    await screen.findByRole("heading", { name: "Add collaborator" })
    fireEvent.click(screen.getByRole("button", { name: /Back to/ }))
    await screen.findByRole("button", { name: "From Reports" })
    expect(screen.queryByRole("heading", { name: "Add collaborator" })).not.toBeInTheDocument()
  })
})

describe("project readiness", () => {
  it("lands an empty existing directory before opening a project", async () => {
    const opened = vi.fn(async () => {})
    const f = fixture({}, async request => {
      if (request.type === "shared") return { type: "shared", data: [] }
      if (request.type === "land") return { type: "root", data: root }
      throw new Error(`Unexpected request: ${request.type}`)
    })
    await act(async () =>
      render(
        <DrivePanel {...f} controls={controls} mode="launcher" onOpenProject={opened} confirm={async () => true} />
      )
    )
    fireEvent.click(screen.getByRole("button", { name: /^Library/ }))
    await waitFor(() => expect(opened).toHaveBeenCalled())
    expect(f.requests).toContainEqual({ type: "land", projectId: 1 })
  })
})

describe("Drive settings native configuration", () => {
  it("reconfigures a signed-in folder with the stored user name and displays actual skill installation", async () => {
    const f = fixture({}, async request => {
      if (request.type === "configuration")
        return {
          type: "configuration",
          data: { deviceId: "device-1", userName: "Alice", userId: "7", clientConfig: null }
        }
      if (request.type === "maxAutoDownloadMb") return { type: "maxAutoDownloadMb", data: 20 }
      if (request.type === "skillMirrors")
        return {
          type: "skillMirrors",
          data: [
            {
              projectId: 9,
              projectKey: "skill",
              name: "Research Skill",
              autoInstalled: true,
              pinned: false,
              deptName: "Research",
              localPath: "/drive/skill",
              skillsPath: "/skills/research",
              installed: true
            }
          ]
        }
      if (request.type === "reconfigure") return { type: "done" }
      throw new Error(`Unexpected request: ${request.type}`)
    })
    render(
      <DrivePanel
        {...f}
        controls={controls}
        mode="settings"
        onOpenProject={async () => {}}
        chooseDirectory={async () => "/new-drive"}
        confirm={async () => true}
      />
    )
    await screen.findByText("Research Skill")
    expect(screen.getByText("/skills/research")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Choose folder" }))
    await waitFor(() =>
      expect(f.requests).toContainEqual({ type: "reconfigure", localRoot: "/new-drive", userName: "Alice" })
    )
  })
})

describe("search profile isolation", () => {
  it("ignores a previous generation's deferred index and lets the new profile search immediately", async () => {
    const f = fixture()
    let state = f.controller.getSnapshot()
    const controller = { ...f.controller, getSnapshot: () => state }
    let finishOld!: (entries: Array<{ name: string; isDirectory: boolean }>) => void
    let reads = 0
    f.host.readDirectory = async () => {
      reads++
      if (reads === 1)
        return new Promise(resolve => {
          finishOld = resolve
        })
      return [{ name: "current.md", isDirectory: false }]
    }
    const props = {
      controller,
      host: f.host,
      controls,
      mode: "launcher" as const,
      onOpenProject: async () => {},
      confirm: async () => true
    }
    const view = render(<DrivePanel {...props} />)
    fireEvent.focus(screen.getByRole("textbox", { name: "Search all projects" }))
    await waitFor(() => expect(reads).toBe(1))
    if (!state.snapshot) throw new Error("Expected an attached Drive snapshot")
    state = { ...state, snapshot: { ...state.snapshot, generation: 2 } }
    view.rerender(<DrivePanel {...props} />)
    const input = screen.getByRole("textbox", { name: "Search all projects" })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: "current" } })
    await screen.findByRole("button", { name: /current.md/ })
    await act(async () => finishOld([{ name: "secret.md", isDirectory: false }]))
    fireEvent.change(input, { target: { value: "secret" } })
    expect(screen.queryByRole("button", { name: /secret.md/ })).not.toBeInTheDocument()
  })
  it("marks SSO as a non-submit button inside the token form", async () => {
    const f = fixture({ configured: false }, async request => {
      if (request.type === "ssoConfig") return { type: "ssoConfig", data: { enabled: true } }
      throw new Error(`Unexpected request ${request.type}`)
    })
    render(
      <DrivePanel
        {...f}
        controls={controls}
        mode="settings"
        onOpenProject={async () => {}}
        confirm={async () => true}
      />
    )
    expect(await screen.findByRole("button", { name: "SSO sign in" })).toHaveAttribute("type", "button")
  })
})

it("shows directory failures alongside readable search results", async () => {
  const f = fixture({
    roots: [{ ...root, projectId: 2, projectKey: "private", name: "Private", localPath: "/private" }, root]
  })
  f.host.readDirectory = async path => {
    if (path === "/private") throw new Error("Permission denied")
    return [{ name: "readable.md", isDirectory: false }]
  }
  render(
    <DrivePanel {...f} controls={controls} mode="launcher" onOpenProject={async () => {}} confirm={async () => true} />
  )
  const input = screen.getByRole("textbox", { name: "Search all projects" })
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: "readable" } })
  await screen.findByRole("button", { name: /readable.md/ })
  expect(screen.getByRole("alert")).toHaveTextContent("/private: Permission denied")
})
