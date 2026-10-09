import { invoke } from "@tauri-apps/api/core"
import { useContext, useEffect, useState, type ReactElement } from "react"
import { ChatDirectoryContext } from "../file-actions"
import { fileLocationPath } from "@/lib/open"
import { ResourceContent } from "./resource-content"

type ImagePayload = { data: string; mimeType: string }

export function LinkedImage({ uri, name }: { uri: string; name: string }): ReactElement {
  const cwd = useContext(ChatDirectoryContext)
  const [result, setResult] = useState<{
    uri: string
    cwd: string
    payload: ImagePayload | null
    error: string | null
  } | null>(null)
  useEffect(() => {
    let disposed = false
    if (cwd === null) return
    void (async (): Promise<void> => {
      try {
        let path = uri
        if (/^file:/i.test(uri)) {
          const file = new URL(uri)
          path = file.pathname
          if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1)
          if (file.hostname && file.hostname !== "localhost") path = `//${file.hostname}${path}`
        } else if (!uri.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(uri) && !uri.startsWith("\\\\")) {
          const directory = encodeURI(cwd.replace(/[\\/]$/, "")).replace(/[?#]/g, encodeURIComponent)
          path = `${directory}/${uri}`
        }
        const payload = await invoke<ImagePayload>("chat_read_image", { path: fileLocationPath(path), cwd })
        if (!disposed) setResult({ uri, cwd, payload, error: null })
      } catch (error: unknown) {
        if (!disposed)
          setResult({ uri, cwd, payload: null, error: error instanceof Error ? error.message : String(error) })
      }
    })()
    return () => {
      disposed = true
    }
  }, [uri, cwd])
  const current = result?.uri === uri && result.cwd === cwd ? result : null
  return (
    <div className="min-w-0">
      {current?.payload && <ResourceContent block={{ type: "image", uri, ...current.payload }} />}
      {current?.error && (
        <div role="alert" className="text-muted-foreground text-xs">
          {current.error}
        </div>
      )}
      <ResourceContent block={{ type: "resource_link", uri, name }} />
    </div>
  )
}
