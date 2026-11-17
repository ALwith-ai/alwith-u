import type { DeviceBridge } from "@alwith/module-device/preview"

/** Await every window-scoped view's removal without detaching its device session. */
export function devicePresentation(bridge: DeviceBridge) {
  const views = new Map<string, Promise<void> | null>()
  const mounting = new Set<Promise<string>>()
  let released = false
  const native = bridge.nativeView
  const unmount = async (id: string) => {
    if (!views.has(id)) return
    let pending = views.get(id)
    if (!pending) {
      pending = native!.unmount(id)
      views.set(id, pending)
    }
    await pending
    views.delete(id)
  }
  return {
    bridge: {
      ...bridge,
      nativeView: native && {
        ...native,
        mount(udid: string, layout: Parameters<typeof native.mount>[1]) {
          if (released) return Promise.reject(new Error("Device presentation is moving"))
          const pending = native.mount(udid, layout).then(async (id) => {
            views.set(id, null)
            if (released) await unmount(id)
            return id
          })
          mounting.add(pending)
          void pending.then(
            () => mounting.delete(pending),
            () => mounting.delete(pending)
          )
          return pending
        },
        unmount
      }
    },
    async release() {
      released = true
      await Promise.all([...mounting])
      await Promise.all([...views.keys()].map(unmount))
    }
  }
}
