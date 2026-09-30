import { createContext, useContext, useEffect } from "react"

/** Portalled menus keep their owning hover sidebar visible until they close. */
export const SidebarOverlayContext = createContext<(() => () => void) | null>(null)

export function useSidebarOverlay(open: boolean): void {
  const retain = useContext(SidebarOverlayContext)
  useEffect(() => {
    if (open && retain !== null) return retain()
  }, [open, retain])
}
