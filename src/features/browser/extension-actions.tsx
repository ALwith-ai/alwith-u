import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { useStore } from "zustand"

import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

import { hiddenExtensions } from "./extension-visibility"

/** An extension's toolbar button as it stands for one tab. */
export interface ExtensionAction {
  id: string
  name: string
  title: string
  enabled: boolean
  badge: string
  badgeColor: string
  popup: boolean
  icon: string | null
}
interface PopupGuest {
  label: string
  token: string
}
const report = (error: unknown) => toast.error(String(error))
/** Text that stays readable on a badge colour the extension chose. */
export function badgeText(background: string): string {
  const channels = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(background)
  if (!channels) return "#ffffff"
  const [red, green, blue] = channels.slice(1).map((channel) => Number.parseInt(channel, 16)) as [
    number,
    number,
    number
  ]
  return (red * 299 + green * 587 + blue * 114) / 1000 > 150 ? "#000000" : "#ffffff"
}
/** The browser says when a button changes; this only catches what was said while nothing listened. */
const refreshInterval = 30_000

/** An extension's popup: its own page, live, as large as its content asks. */
function ExtensionPopup({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
  const { t } = useTranslation()
  const [guest, setGuest] = useState<PopupGuest | null>(null)
  const [size, setSize] = useState<[number, number]>([320, 200])
  useEffect(() => {
    let disposed = false
    let opened: PopupGuest | undefined
    void invoke<PopupGuest>("cef_open_guest", { url })
      .then((value) => {
        opened = value
        if (disposed) void invoke("cef_close_guest", { label: value.label }).catch(report)
        else setGuest(value)
      })
      .catch((error: unknown) => {
        if (!disposed) report(error)
      })
    return () => {
      disposed = true
      if (opened) void invoke("cef_close_guest", { label: opened.label }).catch(report)
    }
  }, [url])
  useEffect(() => {
    if (!guest) return
    let disposed = false
    const closed = listen<{ label: string }>("browser-tab-closed", ({ payload }) => {
      if (!disposed && payload.label === guest.label) onClose()
    })
    // Its content decides its size, and may still be laying out; and it closes itself with window.close().
    const measure = () =>
      void invoke<{ width: number; height: number; closing: boolean }>("cef_extension_popup_state", {
        label: guest.label
      })
        .then((state) => {
          if (disposed) return
          if (state.closing) onClose()
          else
            setSize((size) =>
              size[0] === state.width && size[1] === state.height ? size : [state.width, state.height]
            )
        })
        .catch(() => {})
    measure()
    const timer = setInterval(measure, 300)
    return () => {
      disposed = true
      clearInterval(timer)
      void closed.then((unlisten) => unlisten()).catch(() => {})
    }
  }, [guest, onClose])
  return guest ? (
    <embed
      title={t("browser.extensionPopup", { name })}
      type="application/x-chromium-surface-embed"
      data-content-id={guest.token}
      style={{ width: size[0], height: size[1] }}
      className="block"
    />
  ) : (
    <div style={{ width: size[0], height: size[1] }} />
  )
}

/** The extension buttons of the tab that shows `label`. `revision` changes when the page does. */
export function ExtensionActions({
  label,
  active,
  revision,
  onActions,
  request
}: {
  label: string
  active: boolean
  revision: string
  /** Every extension with a button here, shown in the toolbar or not. */
  onActions?: (actions: ExtensionAction[]) => void
  /** A press asked for from elsewhere, for a button the toolbar does not show; a new object asks again. */
  request?: { id: string }
}) {
  const [actions, setActions] = useState<ExtensionAction[]>([])
  const hidden = useStore(hiddenExtensions)
  useEffect(() => onActions?.(actions), [actions, onActions])
  const [popup, setPopup] = useState<{ id: string; url: string } | null>(null)
  const refresh = useCallback(
    () =>
      invoke<ExtensionAction[]>("cef_guest_extension_actions", { label })
        .then(setActions)
        // A tab that is closing has no buttons to show.
        .catch(() => {}),
    [label]
  )
  // Which tab is in front is the application's to say; extensions ask for "the active tab".
  useEffect(() => {
    if (active) void invoke("cef_guest_extension_activate", { label }).catch(() => {})
  }, [active, label])
  useEffect(() => {
    void refresh()
    if (!active) return
    const timer = setInterval(() => void refresh(), refreshInterval)
    return () => clearInterval(timer)
  }, [refresh, active, revision])
  // A badge, an icon or a tooltip changed: the browser says so as it happens.
  useEffect(() => {
    let disposed = false
    const changed = listen<{ label: string }>("browser-extension-actions", ({ payload }) => {
      if (!disposed && payload.label === label) void refresh()
    })
    return () => {
      disposed = true
      void changed.then((unlisten) => unlisten()).catch(() => {})
    }
  }, [label, refresh])
  const closePopup = useCallback(() => {
    setPopup(null)
    void refresh()
  }, [refresh])
  const press = (action: ExtensionAction) =>
    void invoke<string>("cef_guest_extension_trigger", { label, id: action.id })
      .then((url) => {
        if (url) setPopup({ id: action.id, url })
        return refresh()
      })
      .catch(report)
  const pressRequested = useRef(press)
  pressRequested.current = press
  const known = useRef(actions)
  known.current = actions
  useEffect(() => {
    const action = request && known.current.find((entry) => entry.id === request.id)
    if (action?.enabled) pressRequested.current(action)
  }, [request])
  return (
    actions
      // A button taken out of the toolbar is there while its popup is, which needs it to hang on.
      .filter((action) => !hidden.includes(action.id) || popup?.id === action.id)
      .map((action) => (
        <Popover
          key={action.id}
          open={popup?.id === action.id}
          onOpenChange={(open) => {
            if (!open) closePopup()
          }}
        >
          <PopoverTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="relative"
                aria-label={action.title || action.name}
                title={action.title || action.name}
                disabled={!action.enabled}
                onClick={(event) => {
                  // The browser decides what a press does; the popover only follows.
                  event.preventDefault()
                  if (popup?.id === action.id) closePopup()
                  else press(action)
                }}
              />
            }
          >
            {action.icon ? (
              <img src={action.icon} alt="" className="size-4" />
            ) : (
              <span className="text-xs font-medium">{action.name.slice(0, 1)}</span>
            )}
            {action.badge && (
              <span
                className="absolute right-0 bottom-0 rounded-sm px-0.5 text-[9px] leading-3"
                style={{ backgroundColor: action.badgeColor, color: badgeText(action.badgeColor) }}
              >
                {action.badge}
              </span>
            )}
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto overflow-hidden p-0">
            {popup?.id === action.id && <ExtensionPopup url={popup.url} name={action.name} onClose={closePopup} />}
          </PopoverContent>
        </Popover>
      ))
  )
}
