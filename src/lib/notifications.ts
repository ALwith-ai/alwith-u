// Desktop notifications for state changes the user is not looking at.
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification"
import i18n from "@/lib/i18n"
import type { CodexClient } from "@/agent/client"

async function notify(title: string, body: string): Promise<void> {
  let granted = await isPermissionGranted()
  if (!granted) granted = (await requestPermission()) === "granted"
  if (granted) sendNotification({ title, body })
}

/** Fires when a session needs input or finishes a turn while the window is not focused. */
export function watchForNotifications(client: CodexClient): () => void {
  let previous = client.store.getState().sessions
  return client.store.subscribe(state => {
    const current = state.sessions
    if (current === previous) return
    for (const [id, session] of Object.entries(current)) {
      const before = previous[id]
      if (!before || before.state === session.state || document.hasFocus()) continue
      const title = session.title ?? i18n.t("sidebar.untitled")
      if (session.state === "requires_action") void notify(i18n.t("notify.needsInput"), title)
      else if (session.state === "idle" && before.state === "running" && !session.restoring)
        void notify(i18n.t("notify.finished"), title)
    }
    previous = current
  })
}
