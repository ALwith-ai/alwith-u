export type WindowHost<Intent> = {
  exists(): Promise<boolean>
  create(): Promise<void>
  present(): Promise<void>
  deliver(intent: Intent): Promise<void>
}

export function createWindowController<Intent>(host: WindowHost<Intent>): { open(intent?: Intent): Promise<void> } {
  let pending = Promise.resolve()
  return {
    open(intent) {
      const operation = pending.then(async () => {
        if (!(await host.exists())) await host.create()
        if (intent !== undefined) await host.deliver(intent)
        await host.present()
      })
      // Return the rejection to its caller without poisoning later explicit opens.
      pending = operation.then(
        () => undefined,
        () => undefined
      )
      return operation
    }
  }
}
