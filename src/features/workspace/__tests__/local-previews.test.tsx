import { Blob as NodeBlob } from "node:buffer"
import {
  createEditorController,
  type EditorDocument,
  type PreviewContext,
  type PreviewProvider
} from "@alwith/module-editor"
import {
  createPreviewProviders,
  type PreviewHost,
  type PreviewResource,
  prepareHtmlPreview
} from "@alwith/module-editor/previews"
import { createFileSystem } from "@alwith/module-fs"
import { createMemoryAdapter } from "@alwith/module-fs/testing"
import { Editor, editorViewCtx } from "@milkdown/core"
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"
import { routeHistory } from "../editor-shortcuts"

const audioAnalyzers = vi.hoisted(() => ({ destroy: vi.fn() }))
vi.mock("audiomotion-analyzer", () => ({
  default: class {
    destroy = audioAnalyzers.destroy
  }
}))

function documentFixture(path: string, text = ""): EditorDocument {
  return {
    id: "preview-document",
    path,
    kind: text ? "text" : "binary",
    text,
    savedText: text,
    bytes: new TextEncoder().encode(text || "media"),
    encoding: "utf-8",
    bom: false,
    eol: "\n",
    version: "1",
    dirty: false,
    saving: false,
    locked: false,
    externalChange: false,
    status: "loaded",
    loadError: null,
    pinned: true,
    contentRevision: 0
  }
}
function contextFixture(): PreviewContext {
  return { readOnly: false, onChange: vi.fn(), onSave: vi.fn(), onError: vi.fn() }
}
function hostFixture(overrides: Partial<PreviewHost> = {}): PreviewHost {
  return {
    pdfWorkerSrc: "worker.js",
    resolveResource: vi.fn(async () => {
      throw new Error("Unexpected resource")
    }),
    ...overrides
  }
}
function providerFor(host: PreviewHost, id: string): PreviewProvider {
  const provider = createPreviewProviders(host).find(value => value.id === id)
  if (!provider) throw new Error(`Missing preview provider: ${id}`)
  return provider
}
function installObjectUrls(): { create: ReturnType<typeof vi.fn>; revoke: ReturnType<typeof vi.fn> } {
  let sequence = 0
  const create = vi.fn((_blob: Blob) => `blob:preview-${++sequence}`)
  const revoke = vi.fn()
  const OriginalURL = URL
  vi.stubGlobal("Blob", NodeBlob)
  vi.stubGlobal(
    "URL",
    class extends OriginalURL {
      static createObjectURL = create
      static revokeObjectURL = revoke
    }
  )
  return { create, revoke }
}
function captureEditors(): Editor[] {
  const editors: Editor[] = []
  const original = Editor.make
  vi.spyOn(Editor, "make").mockImplementation(() => {
    const editor = original()
    editors.push(editor)
    return editor
  })
  return editors
}
function requiredEditor(editors: Editor[]): Editor {
  const editor = editors[0]
  if (!editor) throw new Error("Milkdown did not create an editor")
  return editor
}
async function markdownReady(editors: Editor[]): Promise<void> {
  await waitFor(() => {
    expect(requiredEditor(editors).status).toBe("Created")
    expect(document.body).toContainOneByRole("textbox")
  })
}
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: ((value: T) => void) | undefined
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return {
    promise,
    resolve: value => {
      if (!resolve) throw new Error("Missing deferred resolver")
      resolve(value)
    }
  }
}
function imageResource(path: string): PreviewResource {
  return { path, mimeType: "image/png", bytes: new Uint8Array([1, 2, 3]) }
}
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

test("Markdown mounting and external replacements do not publish edits or autosave", async () => {
  const editors = captureEditors()
  const context = contextFixture()
  const provider = providerFor(hostFixture({ autoSaveDelay: 800 }), "markdown")
  const initial = documentFixture("/repo/doc.md", "# Initial\n\nText without a trailing newline")
  const rendered = render(provider.render(initial, context))
  await markdownReady(editors)
  expect(context.onChange).not.toHaveBeenCalled()
  vi.useFakeTimers()
  act(() => {
    vi.advanceTimersByTime(1000)
  })
  expect(context.onSave).not.toHaveBeenCalled()
  rendered.rerender(provider.render({ ...initial, text: "# External\n\nNew disk content" }, context))
  expect(screen.getByRole("heading", { name: "External" })).toBeInTheDocument()
  act(() => {
    vi.advanceTimersByTime(1000)
  })
  expect(context.onChange).not.toHaveBeenCalled()
  expect(context.onSave).not.toHaveBeenCalled()
  expect(context.onError).not.toHaveBeenCalled()
})

test("Markdown does not publish read-only collaboration updates or flush an autosave after access is revoked", async () => {
  const editors = captureEditors()
  const context = contextFixture()
  let writable = false
  let initialized = false
  const provider = providerFor(
    hostFixture({
      autoSaveDelay: 800,
      createMarkdownIntegration: () => ({
        configure: () => {},
        ready: async () => {
          initialized = true
        },
        dispose: () => {},
        editable: () => writable,
        serialize: text => text,
        applyExternal: () => false,
        render: () => null
      })
    }),
    "markdown"
  )
  render(provider.render(documentFixture("/repo/shared.md", "# Shared\n\nBody"), context))
  await waitFor(() => expect(initialized).toBe(true))
  vi.useFakeTimers()
  const dispatch = (text: string): void => {
    requiredEditor(editors).action(ctx => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.insertText(text, 1))
    })
  }
  act(() => {
    dispatch("Remote ")
    vi.advanceTimersByTime(1000)
  })
  expect(context.onChange).not.toHaveBeenCalled()
  expect(context.onSave).not.toHaveBeenCalled()
  writable = true
  act(() => dispatch("Writable "))
  expect(context.onChange).toHaveBeenCalledTimes(1)
  writable = false
  act(() => {
    dispatch("Read-only again ")
    vi.advanceTimersByTime(1000)
  })
  expect(context.onChange).toHaveBeenCalledTimes(1)
  expect(context.onSave).not.toHaveBeenCalled()
  expect(context.onError).not.toHaveBeenCalled()
})

test("Markdown publishes edits before an immediate close, and external replacement cancels pending autosave", async () => {
  const editors = captureEditors()
  const confirmClose = vi.fn(async () => "cancel" as const)
  const onError = vi.fn()
  const fs = createFileSystem({
    adapter: createMemoryAdapter({ "/repo/doc.md": "# Initial\n\nParagraph" }),
    reportError: onError
  })
  const controller = createEditorController({ fs, confirmClose, reportError: onError })
  const initial = await controller.open("/repo/doc.md")
  const onChange = vi.fn((text: string) => controller.update(initial.id, text))
  const context: PreviewContext = { readOnly: false, onChange, onSave: vi.fn(), onError }
  const provider = providerFor(hostFixture({ autoSaveDelay: 800 }), "markdown")
  const rendered = render(provider.render(initial, context))
  await markdownReady(editors)
  vi.useFakeTimers()
  act(() => {
    requiredEditor(editors).action(ctx => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.insertText("Edited ", 1))
    })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(controller.getSnapshot().documents[0].dirty).toBe(true)
  })
  expect(await controller.requestClose(initial.id)).toBe(false)
  expect(confirmClose).toHaveBeenCalledTimes(1)
  expect(controller.getSnapshot().documents[0].text).toContain("Edited")
  rendered.rerender(provider.render({ ...initial, text: "# Reloaded\n\nExternal replacement" }, context))
  expect(screen.getByRole("heading", { name: "Reloaded" })).toBeInTheDocument()
  act(() => {
    vi.advanceTimersByTime(1000)
  })
  expect(onChange).toHaveBeenCalledTimes(1)
  expect(context.onSave).not.toHaveBeenCalled()
  expect(onError).not.toHaveBeenCalled()
  rendered.unmount()
  controller.dispose()
})

test("media URL initialization and replacement keep the current source and dispose only the old element", async () => {
  const { revoke } = installObjectUrls()
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {})
  const context = contextFixture()
  const provider = providerFor(hostFixture(), "media")
  const initial = documentFixture("/repo/audio.mp3")
  const rendered = render(provider.render(initial, context))
  await waitFor(() => expect(rendered.container.querySelector("audio")).toHaveAttribute("src", "blob:preview-1"))
  const previous = rendered.container.querySelector("audio")
  rendered.rerender(provider.render({ ...initial, bytes: new Uint8Array([4, 5, 6]) }, context))
  await waitFor(() => expect(rendered.container.querySelector("audio")).toHaveAttribute("src", "blob:preview-2"))
  expect(rendered.container.querySelector("audio")).not.toBe(previous)
  expect(previous).not.toHaveAttribute("src")
  expect(revoke).toHaveBeenCalledWith("blob:preview-1")
  expect(revoke).not.toHaveBeenCalledWith("blob:preview-2")
  rendered.unmount()
  expect(revoke).toHaveBeenCalledWith("blob:preview-2")
  expect(context.onError).not.toHaveBeenCalled()
})

test("failed HTML resource batches wait for delayed siblings and release every allocated URL on unmount", async () => {
  const { create, revoke } = installObjectUrls()
  const delayed = deferred<PreviewResource>()
  const resolveResource = vi.fn(async (_path: string, reference: string): Promise<PreviewResource> => {
    if (reference === "missing.png") throw new Error("Missing image")
    if (reference === "later.png") return delayed.promise
    throw new Error(`Unexpected reference ${reference}`)
  })
  const context = contextFixture()
  const provider = providerFor(hostFixture({ resolveResource }), "html")
  const rendered = render(
    provider.render(
      documentFixture("/repo/doc.html", '<style>div{background-image:url("missing.png"),url("later.png")}</style>'),
      context
    )
  )
  await waitFor(() => expect(resolveResource).toHaveBeenCalledTimes(2))
  expect(context.onError).not.toHaveBeenCalled()
  await act(async () => {
    delayed.resolve(imageResource("/repo/later.png"))
    await delayed.promise
  })
  await screen.findByRole("alert")
  expect(context.onError).toHaveBeenCalledTimes(1)
  expect(create).toHaveBeenCalledTimes(1)
  rendered.unmount()
  expect(revoke).toHaveBeenCalledWith("blob:preview-1")
})

test("HTML unmount aborts a pending resource read without creating late URLs or reporting a stale error", async () => {
  const { create, revoke } = installObjectUrls()
  const delayed = deferred<PreviewResource>()
  const resolveResource = vi.fn(async (_path: string, reference: string): Promise<PreviewResource> =>
    reference === "first.png" ? imageResource("/repo/first.png") : delayed.promise
  )
  const context = contextFixture()
  const provider = providerFor(hostFixture({ resolveResource }), "html")
  const rendered = render(
    provider.render(documentFixture("/repo/doc.html", '<img src="first.png"><img src="later.png">'), context)
  )
  await waitFor(() => expect(resolveResource).toHaveBeenCalledTimes(2))
  rendered.unmount()
  await act(async () => {
    delayed.resolve(imageResource("/repo/later.png"))
    await delayed.promise
  })
  expect(create).toHaveBeenCalledTimes(1)
  expect(revoke).toHaveBeenCalledWith("blob:preview-1")
  expect(context.onError).not.toHaveBeenCalled()
})

test("HTML preview ignores missing favicon and preload hints while preserving its body", async () => {
  const host = hostFixture()
  const source = await prepareHtmlPreview(
    '<html><head><link rel="shortcut icon" href="favicon.ico"><link rel="preload" href="missing-font.woff2" as="font"><link rel="modulepreload" href="unused.js"><link rel="prefetch" href="unused.html"></head><body><h1>Preview content</h1></body></html>',
    "/repo/demo.html",
    host,
    new Set()
  )
  expect(host.resolveResource).not.toHaveBeenCalled()
  expect(source).toContain("Preview content")
  expect(source).not.toContain("favicon.ico")
  expect(source).not.toContain("missing-font.woff2")
  expect(source).not.toContain("unused.js")
  expect(source).not.toContain("unused.html")
})

test.each(["stylesheet", "script"])("HTML preview still reports missing %s dependencies", async kind => {
  const resolveResource = vi.fn(async () => {
    throw new Error("Required dependency unavailable")
  })
  const source =
    kind === "stylesheet"
      ? '<link rel="stylesheet" href="missing.css"><p>Body</p>'
      : '<script src="missing.js"></script><p>Body</p>'
  await expect(
    prepareHtmlPreview(source, "/repo/demo.html", hostFixture({ resolveResource }), new Set())
  ).rejects.toThrow("Required dependency unavailable")
  expect(resolveResource).toHaveBeenCalledOnce()
})

test("Markdown native undo and redo use Milkdown history and publish changes without writing the file", async () => {
  const editors = captureEditors()
  const originalText = "# Heading\n\nParagraph\n"
  const onError = vi.fn()
  const fs = createFileSystem({
    adapter: createMemoryAdapter({ "/repo/history.md": originalText }),
    reportError: onError
  })
  const controller = createEditorController({ fs, confirmClose: async () => "cancel", reportError: onError })
  const initial = await controller.open("/repo/history.md")
  const onChange = vi.fn((text: string) => controller.update(initial.id, text))
  const context: PreviewContext = { readOnly: false, onChange, onSave: vi.fn(), onError }
  const provider = providerFor(hostFixture(), "markdown")
  const rendered = render(provider.render(initial, context))
  const descriptor = Object.getOwnPropertyDescriptor(document, "execCommand")
  const execCommand = vi.fn()
  Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand })
  try {
    await markdownReady(editors)
    act(() => {
      requiredEditor(editors).action(ctx => {
        const view = ctx.get(editorViewCtx)
        view.setProps({ handleScrollToSelection: () => true })
        view.dispatch(view.state.tr.insertText("Edited ", 1))
        view.focus()
      })
    })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(controller.getSnapshot().documents[0].text).toContain("Edited")
    act(() => {
      routeHistory("undo")
    })
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(controller.getSnapshot().documents[0].text).not.toContain("Edited")
    expect(controller.getSnapshot().documents[0].text).toContain("Heading")
    act(() => {
      routeHistory("redo")
    })
    expect(onChange).toHaveBeenCalledTimes(3)
    expect(controller.getSnapshot().documents[0].text).toContain("Edited")
    expect(execCommand).not.toHaveBeenCalled()
    expect(context.onSave).not.toHaveBeenCalled()
    expect(new TextDecoder().decode(await fs.readFile(initial.path))).toBe(originalText)
    expect(onError).not.toHaveBeenCalled()
  } finally {
    rendered.unmount()
    controller.dispose()
    if (descriptor) Object.defineProperty(document, "execCommand", descriptor)
    else Reflect.deleteProperty(document, "execCommand")
  }
})
