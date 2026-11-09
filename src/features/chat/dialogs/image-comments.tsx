import { CheckIcon, Trash2Icon, XIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

import { imagePoint } from "./image-edit"
import type { ImageEditor } from "./image-editor"

export function ImageCommentOverlay({ editor }: { editor: ImageEditor }) {
  const { t } = useTranslation()
  const draft = editor.commentDraft
  const existing = draft !== null && editor.comments.some((comment) => comment.id === draft.id)
  return (
    <div
      className="absolute inset-0 cursor-crosshair"
      role="group"
      aria-label={t("chat.image.edit.commentCanvas")}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault()
          if (!editor.sending) editor.beginComment({ x: 0.5, y: 0.5 })
        }
      }}
      onPointerDown={(event) => {
        if (editor.sending || event.button !== 0 || event.target !== event.currentTarget) return
        event.preventDefault()
        editor.beginComment(imagePoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect()))
      }}
    >
      {editor.comments.map((comment, index) => (
        <Button
          key={comment.id}
          variant="default"
          size="icon-sm"
          className="absolute z-10 size-7 rounded-full border-2 border-background text-xs shadow-md"
          style={{
            left: `${comment.point.x * 100}%`,
            top: `${comment.point.y * 100}%`,
            transform: "translate(-50%, -50%)"
          }}
          aria-label={t("chat.image.edit.editComment", { number: index + 1 })}
          title={comment.text}
          disabled={editor.sending}
          onClick={() => editor.setCommentDraft({ ...comment })}
        >
          {index + 1}
        </Button>
      ))}
      {draft && (
        <>
          {!existing && (
            <span
              aria-hidden
              className="pointer-events-none absolute z-10 grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-background bg-primary text-xs text-primary-foreground shadow-md"
              style={{ left: `${draft.point.x * 100}%`, top: `${draft.point.y * 100}%` }}
            >
              {editor.comments.length + 1}
            </span>
          )}
          <form
            className="absolute z-20 flex w-72 max-w-full cursor-default items-end gap-1 rounded-xl border bg-popover p-2 text-popover-foreground shadow-lg"
            style={{
              ...(draft.point.x > 0.5
                ? { right: `${(1 - draft.point.x) * 100}%` }
                : { left: `${draft.point.x * 100}%` }),
              ...(draft.point.y > 0.5
                ? { bottom: `calc(${(1 - draft.point.y) * 100}% + 20px)` }
                : { top: `calc(${draft.point.y * 100}% + 20px)` })
            }}
            onSubmit={(event) => {
              event.preventDefault()
              editor.saveComment()
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault()
                event.stopPropagation()
                editor.setCommentDraft(null)
              }
            }}
          >
            <Textarea
              key={draft.id}
              autoFocus
              rows={2}
              className="max-h-36 min-h-12 min-w-0 flex-1 resize-none border-0 p-1 shadow-none focus-visible:ring-0"
              value={draft.text}
              disabled={editor.sending}
              aria-label={t("chat.image.edit.commentText")}
              placeholder={t("chat.image.edit.commentPlaceholder")}
              onChange={(event) => editor.setCommentDraft({ ...draft, text: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  event.stopPropagation()
                  editor.saveComment()
                }
              }}
            />
            <Button
              type="submit"
              size="icon-xs"
              className="rounded-full"
              disabled={editor.sending || !draft.text.trim()}
              aria-label={t("chat.image.edit.saveComment")}
              title={t("chat.image.edit.saveComment")}
            >
              <CheckIcon />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={editor.sending}
              aria-label={t(existing ? "chat.image.edit.deleteComment" : "chat.image.edit.cancelComment")}
              title={t(existing ? "chat.image.edit.deleteComment" : "chat.image.edit.cancelComment")}
              onClick={() => editor.deleteComment()}
            >
              {existing ? <Trash2Icon /> : <XIcon />}
            </Button>
          </form>
        </>
      )}
    </div>
  )
}

export function ImageCommentSummary({ editor }: { editor: ImageEditor }) {
  const { t } = useTranslation()
  if (!editor.comments.length) return null
  return (
    <div
      className="flex max-h-28 w-full max-w-3xl flex-wrap gap-2 overflow-y-auto"
      aria-label={t("chat.image.edit.comments")}
    >
      {editor.comments.map((comment, index) => (
        <Button
          key={comment.id}
          variant="outline"
          size="sm"
          className="max-w-full min-w-0 gap-2 rounded-full text-xs"
          disabled={editor.sending}
          title={comment.text}
          aria-label={t("chat.image.edit.editComment", { number: index + 1 })}
          onClick={() => editor.setCommentDraft({ ...comment })}
        >
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
            {index + 1}
          </span>
          <span className="truncate">{comment.text}</span>
        </Button>
      ))}
    </div>
  )
}
