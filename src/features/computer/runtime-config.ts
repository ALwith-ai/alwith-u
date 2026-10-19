/** Keep computer actions inside the host's ownership, stop and preview channel. */
export const computerRuntimeEnv = {
  CODEX_CONFIG: JSON.stringify({
    "features.computer_use": false,
    plugins: { "unified-computer-use@openai-bundled": { enabled: false } }
  })
}
