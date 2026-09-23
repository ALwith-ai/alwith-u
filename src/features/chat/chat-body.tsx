import type { Session } from "@alwith/api"
import { Loader2Icon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { client } from "@/lib/client"
import { ThreadView } from "./thread-view"

export function ChatBody({ session }: { session: Session }) {
  const { t } = useTranslation()
  const reopen = () => {
    client
      .open(session.id, session.cwd)
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : String(error)))
  }
  if (session.restoring)
    return session.items.length === 0 ? (
      <div className="text-muted-foreground flex flex-1 items-center justify-center gap-2 text-sm">
        <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
        {t("chat.restoring")}
      </div>
    ) : (
      <ThreadView session={session} />
    )
  if (!session.attached)
    return (
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyTitle>{t("chat.reopen")}</EmptyTitle>
          <EmptyDescription>{t("chat.detached")}</EmptyDescription>
        </EmptyHeader>
        <Button onClick={reopen}>{t("chat.reopen")}</Button>
      </Empty>
    )
  if (session.items.length === 0 && session.state === "idle")
    return (
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyTitle>{t("welcome.title")}</EmptyTitle>
          <EmptyDescription className="truncate font-mono">{session.cwd}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  return <ThreadView session={session} />
}
