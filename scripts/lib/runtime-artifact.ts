import { join } from "node:path"

/** A neighbouring checkout must never silently change a release build's inputs. */
export function runtimeSource(value: string | undefined): "release" | "sibling" {
  if (value === undefined || value === "release") return "release"
  if (value === "sibling") return "sibling"
  throw new Error(`RUNTIME_SOURCE must be sibling or release, got ${value}`)
}

/** Cargo's native and explicit cross-target builds have different artifact directories. */
export function runtimeBuildArtifact(sibling: string, target: string, hostTarget: string): string {
  const suffix = target.includes("windows") ? ".exe" : ""
  return join(sibling, "target", ...(target === hostTarget ? [] : [target]), "release", `alwith-runtime${suffix}`)
}

/** An extracted release executable is reusable only for the same version AND target. */
export function runtimeReleaseCache(binaries: string, version: string, target: string): string {
  return join(binaries, ".alwith-runtime", version, target)
}

export function stageTarget(argument: string | undefined, tauriTarget: string | undefined, hostTarget: string): string {
  return argument ?? tauriTarget ?? hostTarget
}
