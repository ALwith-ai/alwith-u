import { useEffect, useReducer, useState } from "react"
import { createPortal } from "react-dom"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/alwith-ui/select"
import { Switch } from "@/components/ui/switch"

type NativeControl = HTMLSelectElement | HTMLInputElement
type ControlMount = { input: NativeControl; container: HTMLSpanElement; restore: () => void }

/** Present DOM-based extension settings through host controls without changing extension callbacks. */
export function ExtensionSettingsControls({ container }: { container: HTMLElement }) {
  const [mounts, setMounts] = useState<ControlMount[]>([])
  useEffect(() => {
    const controls = new Map<NativeControl, ControlMount>()
    const scan = () => {
      let changed = false
      for (const [input, mount] of controls) {
        if (!container.contains(input) || !container.contains(mount.container)) {
          mount.restore()
          controls.delete(input)
          changed = true
        }
      }
      for (const input of container.querySelectorAll<NativeControl>('select, input[type="checkbox"]')) {
        if (
          controls.has(input) ||
          input.closest("[data-extension-control]") ||
          input.hidden ||
          input.getAttribute("aria-hidden") === "true"
        )
          continue
        const host = document.createElement("span")
        host.dataset.extensionControl = ""
        host.className = input instanceof HTMLSelectElement ? "extension-select-control" : "extension-switch-control"
        const display = input.style.getPropertyValue("display")
        const priority = input.style.getPropertyPriority("display")
        const hidden = input.hidden
        input.hidden = true
        input.style.setProperty("display", "none", "important")
        input.after(host)
        controls.set(input, {
          input,
          container: host,
          restore: () => {
            input.hidden = hidden
            if (display) input.style.setProperty("display", display, priority)
            else input.style.removeProperty("display")
            host.remove()
          }
        })
        changed = true
      }
      if (changed) setMounts([...controls.values()])
    }
    scan()
    const observer = new MutationObserver(scan)
    observer.observe(container, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      for (const mount of controls.values()) mount.restore()
    }
  }, [container])
  return mounts.map(({ input, container: target }) => createPortal(<ExtensionControl input={input} />, target))
}

function ExtensionControl({ input }: { input: NativeControl }) {
  const [, refresh] = useReducer((value: number) => value + 1, 0)
  useEffect(() => {
    // SDK setValue writes properties, which MutationObserver does not observe.
    const properties = input instanceof HTMLSelectElement ? ["value", "selectedIndex"] : ["checked"]
    const restore: (() => void)[] = []
    for (const property of properties) {
      const own = Object.getOwnPropertyDescriptor(input, property)
      const descriptor = own ?? Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), property)
      if (!descriptor?.get || !descriptor.set || descriptor.configurable === false)
        throw new Error(`Extension control property is not configurable: ${property}`)
      Object.defineProperty(input, property, {
        configurable: true,
        get: () => descriptor.get!.call(input),
        set: (value) => {
          descriptor.set!.call(input, value)
          refresh()
        }
      })
      restore.push(() => {
        if (own) Object.defineProperty(input, property, own)
        else Reflect.deleteProperty(input, property)
      })
    }
    const observer = new MutationObserver(refresh)
    observer.observe(input, { attributes: true, childList: true, subtree: true, characterData: true })
    const name = input.closest(".setting-item")?.querySelector(".setting-item-name")
    if (name) observer.observe(name, { childList: true, subtree: true, characterData: true })
    input.addEventListener("input", refresh)
    input.addEventListener("change", refresh)
    return () => {
      observer.disconnect()
      input.removeEventListener("input", refresh)
      input.removeEventListener("change", refresh)
      restore.forEach((dispose) => dispose())
    }
  }, [input])
  const label =
    input.getAttribute("aria-label") ??
    input.labels?.[0]?.textContent ??
    input.closest(".setting-item")?.querySelector(".setting-item-name")?.textContent ??
    input.title
  const change = () => {
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new Event("change", { bubbles: true }))
  }
  if (input instanceof HTMLSelectElement) {
    const options = Array.from(input.options).map((option) => ({
      value: option.value,
      label: option.label,
      disabled:
        option.disabled || (option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled)
    }))
    return (
      <Select
        value={input.value}
        items={options}
        disabled={input.disabled}
        onValueChange={(value) => {
          if (value === null) return
          input.value = value
          change()
        }}
      >
        <SelectTrigger className="w-full" aria-label={label || undefined}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }
  return (
    <Switch
      checked={input.checked}
      disabled={input.disabled}
      aria-label={label || undefined}
      onCheckedChange={(checked) => {
        input.checked = checked
        change()
      }}
    />
  )
}
