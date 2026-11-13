import { useState } from "react"
import { flushSync } from "react-dom"

import { createSurfaceOperation } from "./surface-operation"

export function useSurfaceOperation() {
  const [busy, setBusy] = useState(false)
  const [operation] = useState(() =>
    createSurfaceOperation((value) => {
      // Protect the composer during draft changes; the rest of the window stays interactive.
      flushSync(() => setBusy(value))
    })
  )
  return { busy, operation }
}
