import { useEffect, useState } from "react"

/** Whether Cmd itself is held, independent of digit keys; controls the session list's Cmd+1 through Cmd+9 hints.
 * Clear on blur (window/app switch) so a missed keyup cannot leave the hints permanently visible. */
export function useCmdHeld(): boolean {
  const [held, setHeld] = useState(false)
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Meta") setHeld(true)
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === "Meta") setHeld(false)
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
