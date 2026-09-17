import { join } from "node:path"

/** A neighbouring checkout must never silently change a release build's inputs. */
export function runtimeSource(value: string | undefined): "npm" | "sibling" {
  if (value === undefined || value === "npm") return "npm"
  if (value === "sibling") return "sibling"
  throw new Error(`RUNTIME_SOURCE must be sibling or npm, got ${value}`)
}

/** Cargo's native and explicit cross-target builds have different artifact directories. */
export function runtimeBuildArtifact(sibling: string, target: string, hostTarget: string): string {
  const suffix = target.includes("windows") ? ".exe" : ""
  return join(sibling, "target", ...(target === hostTarget ? [] : [target]), "release", `alwith-runtime${suffix}`)
}

export function stageTarget(argument: string | undefined, tauriTarget: string | undefined, hostTarget: string): string {
  return argument ?? tauriTarget ?? hostTarget
}
