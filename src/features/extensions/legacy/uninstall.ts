interface UninstallCompletion {
  state(): { installed: boolean; pending: boolean }
  subscribe(listener: () => void): () => void
  cleanup(): Promise<void>
}

/** request() settles this window; other windows may still hold activation leases. */
export async function waitForLegacyUninstall(completion: UninstallCompletion): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let unsubscribe: (() => void) | undefined
    const inspect = (): void => {
      try {
        const { installed, pending } = completion.state()
        if (pending) return
        unsubscribe?.()
        if (installed) reject(new Error("扩展卸载未完成，保留现有数据和目录授权"))
        else resolve()
      } catch (error) {
        unsubscribe?.()
        reject(error)
      }
    }
    unsubscribe = completion.subscribe(inspect)
    inspect()
  })
  await completion.cleanup()
}
