import { Blob as NodeBlob } from "node:buffer"
import { afterEach, expect, test, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { ImagePreview, createEditorController } from "@alwith/module-editor"
import { createFileSystem } from "@alwith/module-fs"
import { createMemoryAdapter } from "@alwith/module-fs/testing"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
test("SVG preview reflects unsaved source and revokes the previous image URL", async () => {
  const blobs: NodeBlob[] = []
  const revoke = vi.fn()
  vi.stubGlobal("Blob", NodeBlob)
  vi.stubGlobal("URL", {
    createObjectURL: (blob: NodeBlob) => {
      blobs.push(blob)
      return `blob:image${blobs.length}`
    },
    revokeObjectURL: revoke
  })
  const fs = createFileSystem({
    adapter: createMemoryAdapter({ "/a/test.svg": '<svg xmlns="http://www.w3.org/2000/svg"><text>old</text></svg>' }),
    reportError: error => {
      throw error
    }
  })
  const editor = createEditorController({
    fs,
    confirmClose: async () => "cancel",
    reportError: error => {
      throw error
    }
  })
  const document = await editor.open("/a/test.svg")
  const onError = vi.fn()
  const view = render(<ImagePreview document={document} onError={onError} />)
  await screen.findByRole("img")
  expect(blobs[0].type).toBe("image/svg+xml")
  fireEvent.error(screen.getByRole("img"))
  expect(screen.getByRole("alert")).toBeInTheDocument()
  editor.update(document.id, '<svg xmlns="http://www.w3.org/2000/svg"><text>edited</text></svg>')
  view.rerender(<ImagePreview document={editor.getSnapshot().documents[0]} onError={onError} />)
  await waitFor(() => expect(screen.getByRole("img")).toHaveAttribute("src", "blob:image2"))
  expect(await blobs[1].text()).toContain("edited")
  expect(screen.queryByRole("alert")).toBeNull()
  expect(revoke).toHaveBeenCalledWith("blob:image1")
  view.unmount()
  expect(revoke).toHaveBeenCalledWith("blob:image2")
  editor.dispose()
})
