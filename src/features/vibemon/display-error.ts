import { reportBackgroundError } from "@/lib/background-errors"

/** Normalize the product name only when displaying errors, preserving native and transport identifiers. */
export function vibemonErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replaceAll(/\bvibemon\b/gi, "Vibémon")
}

export function reportVibemonError(error: unknown): void {
  reportBackgroundError("vibemon-operation", error, { message: vibemonErrorMessage(error) })
}
