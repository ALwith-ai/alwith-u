import {
  PromptInputTextarea as SharedTextarea,
  type PromptInputTextareaHandle,
  type PromptInputTextareaProps
} from "@alwith/module-chat/composer-textarea"
import { forwardRef } from "react"
import { cn } from "@/lib/utils"
export type { PromptInputTextareaHandle, PromptInputTextareaProps } from "@alwith/module-chat/composer-textarea"

export const PromptInputTextarea = forwardRef<PromptInputTextareaHandle, PromptInputTextareaProps>(
  ({ className, ...props }, ref) => (
    <SharedTextarea
      rows={2}
      {...props}
      ref={ref}
      bashMode={false}
      className={cn("min-h-[calc(var(--chat-input-line-height)*2)] bg-transparent", className)}
    />
  )
)
PromptInputTextarea.displayName = "PromptInputTextarea"
