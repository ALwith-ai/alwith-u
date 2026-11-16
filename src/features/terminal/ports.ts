import type { TerminalSessionPorts } from "@alwith/module-terminal"
import { terminalClient } from "@alwith/module-terminal/tauri"
import { isTauri } from "@tauri-apps/api/core"
import { useEffect, useState } from "react"

import { logBackgroundError } from "@/lib/background-errors"

export type TerminalPorts = Readonly<Record<string, readonly number[]>>

/** Native PTY metadata supplements ports without changing Runtime run states. */
export function useTerminalPorts(sessionIds: readonly string[]): TerminalPorts {
  const key = JSON.stringify([...new Set(sessionIds)].sort())
  const [ports, setPorts] = useState<TerminalPorts>({})
  useEffect(() => {
    setPorts({})
    const ids = JSON.parse(key) as string[]
    if (!isTauri() || ids.length === 0) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let failed = false
    const poll = async () => {
      try {
        const result: TerminalSessionPorts[] = await terminalClient.listeningPorts(ids)
        if (disposed) return
        const next = Object.fromEntries(result.map(({ sessionId, ports }) => [sessionId, ports]))
        setPorts((previous) => (JSON.stringify(previous) === JSON.stringify(next) ? previous : next))
        failed = false
      } catch (error) {
        if (!disposed && !failed) logBackgroundError("terminal/listening-ports", error)
        failed = true
      } finally {
        if (!disposed)
          timer = setTimeout(() => {
            void poll()
          }, 500)
      }
    }
    void poll()
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [key])
  return ports
}

export function mergeListeningPorts(runtime: readonly number[], terminal: readonly number[] = []): number[] {
  return [...new Set([...runtime, ...terminal])].sort((a, b) => a - b)
}
