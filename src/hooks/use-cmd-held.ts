import { useEffect, useState } from "react"
import { isMac } from "@/lib/platform"

/** Whether the platform primary modifier is held; controls activity navigation hints.
 * Clear on blur (window/app switch) so a missed keyup cannot leave the hints permanently visible. */
export function useCmdHeld(): boolean {
  const [held, setHeld] = useState(false)
  useEffect(() => {
    const modifier = isMac() ? "Meta" : "Control"
    const down = (e: KeyboardEvent) => {
      if (e.key === modifier) setHeld(true)
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === modifier) setHeld(false)
    }
    const blur = () => setHeld(false)
    window.addEventListener("keydown", down)
    window.addEventListener("keyup", up)
    window.addEventListener("blur", blur)
    return () => {
      window.removeEventListener("keydown", down)
      window.removeEventListener("keyup", up)
      window.removeEventListener("blur", blur)
    }
  }, [])
  return held
}
