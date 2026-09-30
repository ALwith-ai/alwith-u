import { createCommonCapabilities } from "@alwith/module-extension/host"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"

/** Policies and presentation belong to the host; lifecycle and IO adapters are shared. */
export const commonCapabilities = createCommonCapabilities({
  native: invoke,
  clipboard: { writeText: text => navigator.clipboard.writeText(text) },
  notices: {
    show(message, duration = 5000, onClose) {
      const options = { duration: duration === 0 ? Infinity : duration, onDismiss: onClose, onAutoClose: onClose }
      const id = toast(message, options)
      return {
        hide: () => {
          toast.dismiss(id)
        },
        setMessage: text => {
          toast(text, { id, ...options })
        }
      }
    }
  }
})
