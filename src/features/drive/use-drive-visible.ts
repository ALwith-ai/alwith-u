import { usePlatformAuth } from "@/features/auth/store"
import { isDriveVisible } from "./visibility"

export function useDriveVisible(): boolean {
  return usePlatformAuth(state => isDriveVisible(state.isAuthenticated, state.user?.login_email))
}
