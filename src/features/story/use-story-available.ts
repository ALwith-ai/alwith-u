import { useEffect, useState } from "react"
import { storyAvailable } from "./story-client"

/** Whether the Runtime loaded the story module; probed once per mount, false until known. */
export function useStoryAvailable(): boolean {
  const [available, setAvailable] = useState(false)
  useEffect(() => {
    let cancelled = false
    void storyAvailable()
      .then(ok => {
        if (!cancelled) setAvailable(ok)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  return available
}
