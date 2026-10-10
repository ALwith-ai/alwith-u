import type { Dispose } from "@alwith/module-extension"
import type { CapabilityBinding } from "@alwith/module-extension/host"

interface EventTransport {
  listen(event: string, callback: (payload: unknown) => void): Promise<Dispose>
  emit(event: string, payload: unknown): Promise<void>
}

/** Use one namespace across windows, with an independent lifetime for each activation. */
export function createPluginEvents(
  extensionId: string,
  binding: Pick<CapabilityBinding, "cancellation" | "own">,
  transport: EventTransport
): EventTransport {
  const channel = (event: string): string => {
    if (!event || event.length > 256 || !/^[a-zA-Z0-9_:/-]+$/.test(event)) {
      throw new Error("无效的扩展事件名称")
    }
    const identity = Array.from(new TextEncoder().encode(extensionId), byte => byte.toString(16).padStart(2, "0")).join(
      ""
    )
    return `alwith-plugin:${identity}:${event}`
  }
  return {
    async listen(event, callback): Promise<Dispose> {
      binding.cancellation.throwIfAborted()
      let active = true
      const dispose = await transport.listen(channel(event), payload => {
        if (active && !binding.cancellation.aborted) callback(payload)
      })
      const release = (): void | Promise<void> => {
        if (!active) return
        active = false
        return dispose()
      }
      try {
        binding.cancellation.throwIfAborted()
        return binding.own(release)
      } catch (error) {
        await release()
        throw error
      }
    },
    async emit(event, payload): Promise<void> {
      binding.cancellation.throwIfAborted()
      await transport.emit(channel(event), payload)
      binding.cancellation.throwIfAborted()
    }
  }
}
