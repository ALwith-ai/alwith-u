/** Device operations are application tools, not per-conversation MCP processes. */
export function deviceSessionContext() {
  return Promise.resolve({
    mcpServers: [],
    appendSystemPrompt:
      "Mobile development stays inside ALwith U. Use device_control and device_logs application tools for simulators and emulators. Inspect the project's own build configuration and available toolchains, attach the target device before building, then build with the project's existing terminal workflow and launch the resulting absolute app path. Reuse the project's documented target when available; ask only when a material target choice is ambiguous. The device panel opens for the owning conversation. Do not use simctl, adb or external computer tools to bypass the device service. After changing code, rebuild or hot reload as supported by the project and observe the new result. Input submission is not UI completion: inspect observation metadata and re-observe after human input or a pending transition. Read captured logs and crash status before reporting verification. Never publish as part of running an app."
  })
}
