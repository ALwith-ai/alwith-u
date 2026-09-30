/**
 * Shared sidebar background for hovered and selected rows.
 *
 * Use a translucent overlay instead of solid tokens such as `bg-accent`: with the glass panel removed, rows sit directly over frosted glass and wallpaper.
 * A solid fill looks like pasted paper; a low-opacity foreground overlay darkens or lightens the background while preserving the wallpaper texture.
 * Light and dark themes invert this automatically. This is an explicit exception to the project's ban on custom translucency (user decision, 2026-07-26).
 *
 * The constants differ only in attribute syntax: shadcn `Item` uses `data-[active=true]`, while shadcn `Sidebar`
 * menu buttons use `data-active` / `active:`. Values must match; defining them independently caused inconsistent hover styles
 * between the upper menu and lower list (user feedback, 2026-07-26). Tailwind requires literal classes, so they cannot be composed dynamically.
 */

/** Codex list token: 8% on hover, 5% when selected; hover is stronger than static selection. */
export const ROW_HIGHLIGHT = "hover:bg-foreground/8 data-[active=true]:bg-foreground/5"

/** Navigation menu buttons. */
export const MENU_HIGHLIGHT = "hover:bg-foreground/8 data-active:bg-foreground/5"
