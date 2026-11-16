export function desktopArgs(platform: string, mode: string | undefined, extra: string[] = []) {
  if (mode !== "dev" && mode !== "build") throw new Error("Use dev or build")
  if (platform !== "darwin" && platform !== "win32") throw new Error("Only macOS and Windows are supported")
  if (extra.some((arg) => /^(--features|--no-default-features|--target)(=|$)/.test(arg)))
    throw new Error("Backend and target selection are owned by the desktop build policy")
  const development = mode === "dev" || extra.includes("--debug")
  const feature = platform === "win32" ? "runtime-wry" : development ? "dev-backends" : "experimental-cef"
  const features = [
    feature,
    ...(development ? ["hasgard-testing"] : []),
    ...(mode === "build" ? ["tauri/custom-protocol"] : [])
  ]
  // The Tauri CLI has no --no-default-features of its own; Cargo receives it after `--`.
  return [
    mode,
    "--features",
    features.join(","),
    ...(development ? ["--config", "src-tauri/tauri.dev-instance.conf.json"] : []),
    ...extra,
    "--",
    "--no-default-features"
  ]
}
