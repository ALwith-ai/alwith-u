import { useCallback, useRef, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
export interface DialogRequest {
  title: string
  detail: string
  initial?: string
  choices: readonly { label: string; value: string }[]
}
export function useHostDialog(): { ask: (request: DialogRequest) => Promise<string | null>; dialog: ReactNode } {
  const { t } = useTranslation()
  const [request, setRequest] = useState<DialogRequest | null>(null),
    [input, setInput] = useState("")
  const pending = useRef<{ request: DialogRequest; resolve: (value: string | null) => void }[]>([])
  const active = useRef<((value: string | null) => void) | null>(null)
  const next = useCallback((): void => {
    const item = pending.current.shift()
    if (!item) {
      active.current = null
      setRequest(null)
      return
    }
    active.current = item.resolve
    setRequest(item.request)
    setInput(item.request.initial === undefined ? "" : item.request.initial)
  }, [])
  const ask = useCallback(
    (value: DialogRequest): Promise<string | null> =>
      new Promise(resolve => {
        pending.current.push({ request: value, resolve })
        if (active.current === null) next()
      }),
    [next]
  )
  function finish(value: string | null): void {
    const resolve = active.current
    if (resolve !== null) resolve(value)
    next()
  }
  const dialog = (
    <Dialog
      open={request !== null}
      onOpenChange={open => {
        if (!open) finish(null)
      }}>
      <DialogContent>
        {request && (
          <form
            onSubmit={event => {
              event.preventDefault()
              if (request.initial !== undefined && input.trim()) finish(input)
            }}>
            <DialogHeader>
              <DialogTitle>{request.title}</DialogTitle>
              <DialogDescription className="break-all whitespace-pre-wrap">{request.detail}</DialogDescription>
            </DialogHeader>
            {request.initial !== undefined && (
              <Input
                autoFocus
                className="my-4"
                aria-label={request.title}
                value={input}
                onChange={event => setInput(event.target.value)}
              />
            )}
            <DialogFooter className="mt-4">
              <Button type="button" onClick={() => finish(null)}>
                {t("workspace.cancel")}
              </Button>
              {request.choices.map(choice => (
                <Button
                  key={choice.value}
                  type="button"
                  disabled={request.initial !== undefined && !input.trim()}
                  onClick={() => finish(request.initial === undefined ? choice.value : input)}>
                  {choice.label}
                </Button>
              ))}
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
  return { ask, dialog }
}
