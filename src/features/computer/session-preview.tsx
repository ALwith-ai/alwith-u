import { isTauri } from "@tauri-apps/api/core"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { commands, type ComputerPreview, events } from "@/bindings"
import { client } from "@/lib/client"

import { ComputerPreviewCard } from "./preview-card"

/** Ephemeral frames are scoped to a visible conversation, never added to its history. */
export function SessionPreview({ sessionId }: { sessionId: string }) {
  const [preview, setPreview] = useState<ComputerPreview | null>(null)
  const [stopping, setStopping] = useState(false)
  useEffect(() => {
    if (!isTauri()) return
    const subscriptionId = crypto.randomUUID()
    let disposed = false
    let unlisten: (() => void) | undefined
    const subscribe = async () => {
      unlisten = await events["computer:preview"].listen(({ payload }) => {
        if (!disposed && payload.subscriptionId === subscriptionId && payload.activity.sessionId === sessionId) {
          setPreview(payload)
        }
      })
      if (disposed) {
        unlisten()
        return
      }
      await commands.computerSubscribe({ sessionId, subscriptionId })
      if (disposed) await commands.computerUnsubscribe({ subscriptionId })
    }
    void subscribe().catch((error: unknown) => {
      if (!disposed) toast.error(String(error))
    })
    return () => {
      disposed = true
      unlisten?.()
      void commands.computerUnsubscribe({ subscriptionId }).catch(() => {})
    }
  }, [sessionId])
  if (preview?.activity.sessionId !== sessionId || preview.activity.phase === "idle") return null
  const stop = async () => {
    setStopping(true)
    try {
      await client.cancel(sessionId)
    } catch (error) {
      toast.error(String(error))
    } finally {
      setStopping(false)
    }
  }
  const focus = async () => {
    try {
      await commands.computerFocus({ sessionId, revision: preview.activity.revision })
    } catch (error) {
      toast.error(String(error))
    }
  }
  return (
    <ComputerPreviewCard
      onFocus={() => void focus()}
      key={sessionId}
      preview={preview}
      stopping={stopping}
      onStop={() => void stop()}
    />
  )
}
