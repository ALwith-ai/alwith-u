import { WebviewWindow } from "@tauri-apps/api/webviewWindow"

import { createWindowController } from "@/lib/window-controller"

const controller = createWindowController<void>({
  exists: async () => (await WebviewWindow.getByLabel("guide")) !== null,
  create: async () => {
    const windows = /Win/.test(navigator.platform)
    const window = new WebviewWindow("guide", {
      url: "/guide.html",
      title: "ALwith U Guide",
      width: 1000,
      height: 760,
      minWidth: 640,
      minHeight: 480,
      center: true,
      hiddenTitle: !windows,
      titleBarStyle: windows ? "visible" : "overlay",
      visible: false
    })
    let ready!: () => void
    let fail!: (error: Error) => void
    const created = new Promise<void>((resolve, reject) => {
      ready = resolve
      fail = reject
    })
    const listeners: (() => void)[] = []
    const timer = setTimeout(() => fail(new Error("Guide window creation timed out")), 15_000)
    try {
      await Promise.all([
        created,
        window.once("tauri://created", ready).then(stop => listeners.push(stop)),
        window
          .once("tauri://error", ({ payload }) => fail(new Error(String(payload))))
          .then(stop => listeners.push(stop))
      ])
    } finally {
      clearTimeout(timer)
      for (const stop of listeners) stop()
    }
  },
  present: async () => {
    const window = await WebviewWindow.getByLabel("guide")
    if (!window) throw new Error("Guide window is unavailable")
    await window.unminimize()
    await window.show()
    await window.setFocus()
  },
  deliver: async () => {}
})

export function openGuideWindow(): Promise<void> {
  return controller.open()
}
