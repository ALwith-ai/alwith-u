import { extensionApiCompatibilityVersions, extensionApiVersion } from "@alwith/module-extension"
import type { HostOptions } from "@alwith/module-extension/host"

export const extensionApiSupport = {
  apiVersion: extensionApiVersion,
  apiCompatibilityVersions: extensionApiCompatibilityVersions
} satisfies Pick<HostOptions, "apiVersion" | "apiCompatibilityVersions">
