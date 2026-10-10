/** Match the account policy used by the desktop host, without developer overrides. */
export function isDriveVisible(authenticated: boolean, email: string | null | undefined): boolean {
  return authenticated && (email?.toLowerCase().endsWith("@finture.id") ?? false)
}
