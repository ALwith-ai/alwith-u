import { useEffect, useState } from "react"

/** Cmd 键是否正按住不放(不看数字键,单纯 Cmd 本身的状态)——会话列表 ⌘1~9 数字提示按此显隐。
 *  blur(切窗口/切 app)兜底清掉,避免 keyup 漏接导致提示卡住常显。 */
export function useCmdHeld(): boolean {
  const [held, setHeld] = useState(false)
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Meta") setHeld(true)
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === "Meta") setHeld(false)
    }
    const blur = () => setHeld(false)
    window.addEventListener("keydown", down)
    window.addEventListener("keyup", up)
    window.addEventListener("blur", blur)
    return () => {
      window.removeEventListener("keydown", down)
      window.removeEventListener("keyup", up)
      window.removeEventListener("blur", blur)
    }
  }, [])
  return held
}
