import { PetCenter } from "@alwith/module-vibemon/react"
import { usePlatformAuth } from "@/features/auth/store"

export function VibemonCenter() {
  const user = usePlatformAuth(state => state.user)
  return (
    <main className="h-full min-h-0 overflow-hidden">
      <PetCenter key={user?.user_uuid} />
    </main>
  )
}
