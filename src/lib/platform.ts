/** True on macOS, where the primary modifier is ⌘; everywhere else it is Ctrl. */
export function isMac(): boolean {
  if (typeof navigator === "undefined") return false
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
  return /mac/i.test(platform ?? navigator.platform)
}
