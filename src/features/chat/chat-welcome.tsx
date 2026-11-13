import { QUICK_CHATS_GROUP, sessionGroup } from "@alwith/module-chat/client"
import { openPath } from "@tauri-apps/plugin-opener"
import type { ReactNode } from "react"
import { Trans, useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useApp } from "@/lib/client"
import { basename } from "@/lib/path"
import { text } from "@/lib/text"

import { useInputMode } from "./composer/input-mode"

function WelcomeProjectName({ project, children }: { project: string; children?: ReactNode }) {
  const { t } = useTranslation()
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="link"
            className="inline h-auto max-w-full rounded-none p-0 align-baseline text-[length:inherit] leading-[inherit] font-normal whitespace-normal text-foreground underline decoration-muted-foreground/50 decoration-dashed decoration-1 underline-offset-6 hover:decoration-foreground active:bg-none!"
            aria-label={`${t("actions.openFolder")}: ${basename(project)}`}
            onClick={() => void openPath(project).catch((error: unknown) => toast.error(text(error)))}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom">{project}</TooltipContent>
    </Tooltip>
  )
}

export function ChatWelcome({ cwd = null }: { cwd?: string | null }) {
  const { t } = useTranslation()
  const inputMode = useInputMode()
  const context = useApp((state) => state.projectContext)
  const project =
    cwd !== null &&
    context !== null &&
    cwd !== context.chatDirectory &&
    sessionGroup(context, { cwd }).id !== QUICK_CHATS_GROUP
      ? cwd
      : null
  const prefix = `chat.inputMode.welcome.${inputMode?.mode ?? "chat"}`
  return (
    <Empty className="flex-1">
      <EmptyHeader className="w-full max-w-3xl text-center">
        <EmptyTitle className="text-[28px] leading-relaxed font-normal [overflow-wrap:anywhere]">
          {project === null ? (
            t(`${prefix}.title`)
          ) : (
            <Trans
              i18nKey={`${prefix}.projectTitle`}
              values={{ project: basename(project) }}
              components={{
                project: <WelcomeProjectName project={project} />
              }}
            />
          )}
        </EmptyTitle>
      </EmptyHeader>
    </Empty>
  )
}
