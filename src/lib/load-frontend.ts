/** Keep this boundary free of application imports so module-link failures remain visible. */
export async function loadFrontend(load: () => Promise<unknown>): Promise<void> {
  try {
    await load()
  } catch (failure) {
    const message = `ALwith U frontend failed to load: ${failure instanceof Error ? failure.message : String(failure)}`
    const details = failure instanceof Error && failure.stack ? `${message}\n${failure.stack}` : message
    const root = document.getElementById("root")
    if (root) {
      root.textContent = details
      root.style.whiteSpace = "pre-wrap"
    }
    console.error(details, failure)
    // Application logging has not initialized when the module graph fails to load.
    // Import the logger separately so a broken application dependency cannot hide the cause.
    if ("__TAURI_INTERNALS__" in window) {
      try {
        const { error } = await import("@tauri-apps/plugin-log")
        await error(details)
      } catch (logFailure) {
        console.error("[frontend failure log]", logFailure)
      }
    }
  }
}
