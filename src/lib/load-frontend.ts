/** Keep this boundary free of application imports so module-link failures remain visible. */
export async function loadFrontend(load: () => Promise<unknown>): Promise<void> {
  try {
    await load()
  } catch (failure) {
    const message = `ALwith U frontend failed to load: ${failure instanceof Error ? failure.message : String(failure)}`
    const root = document.getElementById("root")
    if (root) root.textContent = message
    console.error(message, failure)
  }
}
