/** Native completion events plus a race-safe initial snapshot; identical on Wry and CEF. */
export async function observeWindowMinimized(
  window: {
    listen: (event: string, handler: (event: { payload: boolean }) => void) => Promise<() => void>
    isMinimized: () => Promise<boolean>
  },
  change: (minimized: boolean) => Promise<void>,
  report: (error: unknown) => void
): Promise<{ dispose: () => void; refresh: () => Promise<void> }> {
  let revision = 0
  const stop = await window.listen("alwith:window-minimized", ({ payload }) => {
    ++revision
    void change(payload).catch(report)
  })
  const refresh = async () => {
    const initial = ++revision
    const minimized = await window.isMinimized()
    if (initial === revision) await change(minimized)
  }
  try {
    await refresh()
    return { dispose: stop, refresh }
  } catch (error) {
    stop()
    throw error
  }
}
