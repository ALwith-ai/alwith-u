import type { CapabilityBinding } from "@alwith/module-extension/host"
import type { PluginHost } from "@alwith/module-extension/plugin"
import { isTauri } from "@tauri-apps/api/core"
import { emit, listen } from "@tauri-apps/api/event"

const OPENED_EVENT = "extension://opened"
const presenters = new Set<{ extensionId: string; allow: () => void }>()

/** User-facing pages release consent deferred during background activation, across windows. */
export async function openExtensionConsent(extensionId: string): Promise<void> {
  for (const presenter of presenters) {
    if (presenter.extensionId === extensionId) presenter.allow()
  }
  if (isTauri()) await emit(OPENED_EVENT, extensionId)
}

/** Keep the original modal and decision callbacks; only postpone its presentation. */
export function createStartupConsentPresenter(
  binding: Pick<CapabilityBinding, "manifest" | "cancellation" | "own">,
  onError: (error: unknown) => void
): NonNullable<PluginHost["presentModal"]> {
  let opened = false
  const pending = new Set<() => void>()
  const presenter = {
    extensionId: binding.manifest.id,
    allow(): void {
      if (binding.cancellation.aborted) return
      opened = true
      const queued = [...pending]
      pending.clear()
      for (const present of queued) present()
    }
  }
  presenters.add(presenter)
  binding.own(() => {
    presenters.delete(presenter)
    pending.clear()
  })
  if (isTauri()) {
    void listen<string>(OPENED_EVENT, (event) => {
      if (event.payload === presenter.extensionId) presenter.allow()
    })
      .then((stop) => {
        return Promise.try(() => {
          if (binding.cancellation.aborted) stop()
          else binding.own(stop)
        })
      })
      .catch(onError)
  }
  return (modal, present) => {
    binding.cancellation.throwIfAborted()
    // This policy belongs to the host; the shared binding knows no business extension IDs.
    if (opened || modal.titleEl.textContent?.trim() !== "启用 AI 对话归档同步？") present()
    else pending.add(present)
    return () => {
      pending.delete(present)
    }
  }
}
