import i18n from "i18next"

interface DurationFormatConstructor {
  new (
    locale: string,
    options: { style: "narrow" }
  ): {
    format(duration: { hours: number; minutes: number; seconds: number }): string
  }
}

/**
 * Matches Codex's duration label: seconds carry into minutes and hours, hours drop
 * the seconds, and the platform `Intl.DurationFormat` is preferred when present.
 * Anything under a second shows as 1s so a fast turn never reads as "0s".
 */
export function durationLabel(milliseconds: number): string {
  const total = Math.max(1, Math.round(milliseconds / 1_000))
  const hours = Math.floor(total / 3_600)
  const minutes = Math.floor((total % 3_600) / 60)
  const seconds = total % 60
  const DurationFormat = (Intl as unknown as { DurationFormat?: DurationFormatConstructor }).DurationFormat
  if (DurationFormat) {
    try {
      return new DurationFormat(i18n.language, { style: "narrow" }).format({
        hours,
        minutes,
        seconds: hours > 0 ? 0 : seconds
      })
    } catch {
      // Unknown locale: fall through to the plain template, as Codex does.
    }
  }
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  if (minutes > 0) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
  return `${seconds}s`
}
