/** Disable browser image dragging without intercepting the pet's native window drag gestures. */
export function preventVibemonImageDragging(): () => void {
  document.documentElement.setAttribute("data-vibemon-window", "")
  const preventDrag = (event: DragEvent) => {
    if (event.target instanceof Element && event.target.closest("img") !== null) event.preventDefault()
  }
  document.addEventListener("dragstart", preventDrag, true)
  return () => {
    document.removeEventListener("dragstart", preventDrag, true)
    document.documentElement.removeAttribute("data-vibemon-window")
  }
}
