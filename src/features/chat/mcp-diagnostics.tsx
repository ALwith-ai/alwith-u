import { isContentEntry, isText, type Session } from "@nyssance/codex-acp-v2/client";
import { isMcpStartup } from "@alwith/module-chat/turns"
import { PlugIcon } from "lucide-react"
import { type ReactNode, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"

/** Read diagnostics directly from the displayed Runtime session, including replayed items. */
export function McpDiagnostics({ session }: { session: Session }): ReactNode {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const records = session.items.filter(isMcpStartup)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DropdownMenuItem closeOnClick={false} onClick={() => setOpen(true)}>
        <PlugIcon />
        {t("mcpDiagnostics.title")} ({records.length})
      </DropdownMenuItem>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("mcpDiagnostics.title")}</DialogTitle>
          <DialogDescription>{t("mcpDiagnostics.description")}</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[60vh] gap-4 overflow-y-auto">
          {records.length === 0 && <p className="text-sm text-muted-foreground">{t("mcpDiagnostics.empty")}</p>}
          {records.map((item) => {
            const details = item.content
              .filter(isContentEntry)
              .map((entry) => entry.content)
              .filter(isText)
              .map((block) => block.text)
              .join("\n")
            return (
              <section key={item.id} className="grid min-w-0 gap-2">
                <h3 className="text-sm font-medium">{item.title}</h3>
                <p className="text-sm text-muted-foreground">{t(`mcpDiagnostics.${item.status}`)}</p>
                <pre className="overflow-auto rounded-md bg-muted p-3 text-xs break-words whitespace-pre-wrap">
                  {details}
                </pre>
                <Button
                  className="justify-self-start"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(`${item.title}\n${details}`)
                      .then(() => toast.success(t("actions.copied")))
                      .catch((error: unknown) => toast.error(String(error)))
                  }}
                >
                  {t("actions.copy")}
                </Button>
              </section>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
