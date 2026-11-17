/** Keep native file drops on Tauri's path while leaving page drags available. */
export function installNativeFileDropGuard(target: Window): () => void {
  let entered = false
  const events = ["dragenter", "dragover", "drop", "dragleave"] as const
  const handle = (event: DragEvent): void => {
    if (!entered && !Array.from(event.dataTransfer?.types ?? []).includes("Files")) return

    // The runtime's initialization listener runs first and retains native paths
    // and viewport positions. Components must not consume the same files again.
    event.preventDefault()
    event.stopImmediatePropagation()
    if (event.type === "drop") {
      entered = false
    } else if (event.type === "dragleave") {
      if (
        event.clientX <= 0 ||
        event.clientY <= 0 ||
        event.clientX >= target.innerWidth ||
        event.clientY >= target.innerHeight
      ) {
        entered = false
      }
    } else {
      entered = true
    }
  }
  for (const name of events) target.addEventListener(name, handle, { capture: true })
  return () => {
    for (const name of events) target.removeEventListener(name, handle, { capture: true })
  }
}
