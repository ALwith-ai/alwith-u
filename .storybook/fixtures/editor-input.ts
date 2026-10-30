// Chromium's EditContext receives OS text updates, rather than synthetic DOM input events.
// Simulate that host event while retaining the source Monaco instance and save handlers.
export function typeInEditor(element: HTMLElement, text: string): void {
  element.focus()
  const context = (
    element as HTMLElement & {
      editContext?: EventTarget & {
        selectionStart: number
        selectionEnd: number
        updateText(start: number, end: number, text: string): void
        updateSelection(start: number, end: number): void
      }
    }
  ).editContext
  if (context) {
    const start = context.selectionStart
    const end = context.selectionEnd
    context.updateText(start, end, text)
    context.updateSelection(start + text.length, start + text.length)
    context.dispatchEvent(
      Object.assign(new Event("textupdate"), {
        updateRangeStart: start,
        updateRangeEnd: end,
        text,
        selectionStart: start + text.length,
        selectionEnd: start + text.length
      })
    )
  } else throw new Error("The source Monaco EditContext is not ready")
}
