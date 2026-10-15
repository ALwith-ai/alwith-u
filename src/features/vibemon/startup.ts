import { reportBackgroundError } from "@/lib/background-errors"
import i18n from "@/lib/i18n"
import { getVibemonState, refreshSettings } from "@alwith/module-auth/pets/core"
import { commands } from "@/bindings"

/** Only a login launch overrides the previous enabled state of an equipped pet. */
export async function restorePetOnStartup(
  present: () => Promise<unknown>,
  account: () => string | null
): Promise<boolean> {
  const expected = account()
  if (expected === null) return false
  await refreshSettings()
  const state = await getVibemonState()
  if (!state.pet || (!state.enabled && !(await commands.autostartLaunch())) || account() !== expected) return false
  await present()
  return account() === expected
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
