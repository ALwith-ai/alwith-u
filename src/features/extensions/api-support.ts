import { extensionApiVersion } from "@alwith/module-extension"
import type { HostOptions } from "@alwith/module-extension/host"

// The 0.5.0 release renumbered the unchanged 0.1.0-rc.20 extension API.
export const extensionApiSupport = {
  apiVersion: extensionApiVersion,
  apiCompatibilityVersions: ["0.1.0-rc.20"]
} satisfies Pick<HostOptions, "apiVersion" | "apiCompatibilityVersions">
