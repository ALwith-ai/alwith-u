import { reportBackgroundError } from "@/lib/background-errors"

/** Normalize the product name only when displaying errors, preserving native and transport identifiers. */
export function petErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\bvibemon\b/gi, "Vibémon")
}

export function reportPetError(error: unknown): void {
  reportBackgroundError("pet-operation", error, { message: petErrorMessage(error) })
}
