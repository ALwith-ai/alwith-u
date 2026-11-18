import { invoke } from "@tauri-apps/api/core"

/** Subscribe before reading the native window state so a delayed snapshot cannot win over an event. */
export async function observeWindowHidden(
  window: { listen: (event: string, handler: (event: { payload: boolean }) => void) => Promise<() => void> },
  change: (hidden: boolean) => Promise<void>,
  report: (error: unknown) => void,
  readHidden: () => Promise<boolean> = () => invoke<boolean>("main_window_hidden")
): Promise<{ dispose: () => void; refresh: () => Promise<void> }> {
  let revision = 0
  let last: boolean | undefined
  const publish = async (hidden: boolean) => {
    if (hidden === last) return
    last = hidden
    await change(hidden)
  }
  const stop = await window.listen("alwith:window-hidden", ({ payload }) => {
    ++revision
    void publish(payload).catch(report)
  })
  const refresh = async () => {
    const initial = ++revision
    const hidden = await readHidden()
    if (initial === revision) await publish(hidden)
  }
  const dispose = () => {
    ++revision
    stop()
  }
  try {
    await refresh()
    return { dispose, refresh }
  } catch (error) {
    dispose()
    throw error
  }
}
