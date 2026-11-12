import type { Session } from "@alwith/module-chat/client"

import { LoginCard } from "@/features/connection/login-card"
import { client, useApp } from "@/lib/client"

/** Login restores this conversation's attachment without resending an interrupted turn. */
export function AuthenticationRecovery({ session }: { session: Session }) {
  const methods = useApp((state) => state.agent?.authMethods)
  return (
    <LoginCard
      methods={methods ?? []}
      signIn={async (method, extra) => {
        await client.login(method, extra)
        await client.open(session.id, session.cwd)
      }}
    />
  )
}
