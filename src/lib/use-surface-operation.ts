import { useState } from "react"
import { flushSync } from "react-dom"
import { createSurfaceOperation } from "./surface-operation"

export function useSurfaceOperation() {
  const [busy, setBusy] = useState(false)
  const [operation] = useState(() =>
    createSurfaceOperation(value => {
      // Disable editing before the first asynchronous draft read or window request.
      flushSync(() => setBusy(value))
    })
  )
  return { busy, operation }
}
