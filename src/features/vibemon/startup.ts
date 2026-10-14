import { reportBackgroundError } from "@/lib/background-errors"
import i18n from "@/lib/i18n"
import { getVibemonState, refreshSettings } from "@alwith/module-auth/pets/core"
import { isEnabled } from "@tauri-apps/plugin-autostart"

/** Match Desktop: autostart or the previous enabled state restores an equipped pet. */
export async function restorePetOnStartup(
  present: () => Promise<unknown>,
  account: () => string | null
): Promise<void> {
  const expected = account()
  if (expected === null) return
  await refreshSettings()
  const state = await getVibemonState()
  if (state.pet && (state.enabled || (await isEnabled())) && account() === expected) await present()
}

/** Report a failed automatic restoration once; stale account work must never notify or retry. */
export async function runPetRestoration(
  work: () => Promise<unknown>,
  account: () => string | null,
  retry: () => void
): Promise<void> {
  const expected = account()
  if (expected === null) return
  try {
    await work()
  } catch (error) {
    if (account() !== expected) return
    reportBackgroundError("pet-startup", error, {
      message: i18n.t("pet.restoreFailed"),
      action: {
        label: i18n.t("pet.retry"),
        onClick: () => {
          if (account() === expected) retry()
        }
      }
    })
  }
}
