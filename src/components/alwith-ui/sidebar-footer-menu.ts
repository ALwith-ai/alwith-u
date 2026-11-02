/** Footer menus share the usable row width, excluding the navigation's outer gutters. */
export function sidebarFooterMenuRow(trigger: HTMLElement | null): HTMLElement {
  const row = trigger?.closest<HTMLElement>("[data-sidebar-footer-row]")
  if (!row) throw new Error("Sidebar footer menus require a mounted footer row")
  return row
}
