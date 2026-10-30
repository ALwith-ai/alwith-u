import type { ArgTypes } from "storybook/internal/types"

import { chatCases } from "../fixtures/catalog"
import type { ProductPreviewProps } from "./product-preview"

export const productPreviewArgTypes = {
  platform: { control: "inline-radio", options: ["macos", "windows", "linux"] },
  globalAction: { control: "select", options: [undefined, "form", "url", "multipleForms"] },
  wallpaper: { control: "select", options: [undefined, "cover", "contain", "error"] },
  composerCase: {
    control: "select",
    options: ["ready", "textPending", "textError", "mentionEmpty", "mentionError", "prediction", "predictionError"]
  },
  fileCase: {
    control: "select",
    options: ["ready", "saveError", "savePending", "readError", "moveError", "deleteError", "createError"]
  },
  binaryFiles: { control: "boolean" },
  pluginOperation: {
    control: "select",
    options: [
      "ready",
      "installing",
      "installError",
      "uninstalling",
      "uninstallError",
      "toggling",
      "toggleError",
      "upgrading",
      "upgradeError",
      "skillError"
    ]
  },
  page: {
    control: "select",
    options: [
      "chat",
      "plugins",
      "pluginDetail",
      "extensions",
      "extension",
      "archives",
      "vibemon",
      "settings",
      "login",
      "floating",
      "guide",
      "gamepad",
      "petWindow",
      "petBubble"
    ]
  },
  chatCase: { control: "select", options: [...chatCases] },
  sidebarView: { control: "inline-radio", options: ["sessions", "activity", "drive"] },
  sidebarPinned: { control: "boolean" },
  connection: { control: "select", options: ["ready", "connecting", "disconnected", "failed"] },
  response: { control: "select", options: ["complete", "permission", "question", "error"] },
  file: {
    control: "select",
    options: [
      null,
      "README.md",
      "docs/交付清单.md",
      "src/dashboard.tsx",
      "data/projects.json",
      "data/tasks.csv",
      "assets/brand.svg",
      "preview.html",
      "notes.txt",
      "missing.md",
      "samples/sample.pdf",
      "samples/sample.docx",
      "samples/sample.xlsx",
      "samples/sample.tiff",
      "samples/sample.wav",
      "samples/sample.webm",
      "samples/legacy.doc",
      "samples/unsupported.bin",
      "samples/corrupt.pdf"
    ]
  },
  pluginCase: {
    control: "select",
    options: ["catalog", "installed", "empty", "loading", "error", "detailError", "unavailable"]
  },
  extensionCase: {
    control: "select",
    options: ["installed", "empty", "loading", "pending", "failed", "error", "content", "renderError"]
  },
  driveCase: {
    control: "select",
    options: [
      "ready",
      "empty",
      "unconfigured",
      "offline",
      "error",
      "paused",
      "syncing",
      "failedUploads",
      "conflict",
      "massDelete",
      "deleteError",
      "sharing",
      "sharingReadOnly",
      "sharingError",
      "condenseUnsynced",
      "condenseRunning",
      "condenseDone",
      "condenseError",
      "condenseProposed"
    ]
  },
  archiveCase: {
    control: "select",
    options: [
      "list",
      "empty",
      "loading",
      "many",
      "loadError",
      "restoring",
      "restoreError",
      "deleting",
      "deleteError",
      "partialDelete"
    ]
  },
  computerCase: { control: "select", options: ["enabled", "disabled", "permissions", "unavailable"] },
  petCase: {
    control: "select",
    options: [
      "home",
      "pull",
      "equip",
      "empty",
      "offline",
      "syncError",
      "firstVisit",
      "drawError",
      "insufficient",
      "desktop"
    ]
  },
  height: { control: { type: "number", min: 128, max: 1000 } },
  bubbleCase: {
    control: "select",
    options: ["idle", "running", "permission", "question", "error", "readOnly", "unavailable"]
  },
  gamepadCase: { control: "select", options: ["disconnected", "connected", "running", "error"] },
  settingsSection: {
    control: "select",
    options: [
      "general",
      "appearance",
      "editor",
      "account",
      "provider",
      "voice",
      "computer",
      "extensions",
      "drive",
      "about"
    ]
  },
  extensionId: { control: "select", options: ["unavailable", "demo-0/demo-content", "demo-0/demo-settings"] },
  authCase: {
    control: "select",
    options: [
      "ready",
      "loading",
      "sending",
      "signingIn",
      "registering",
      "registered",
      "network",
      "wrongCode",
      "wrongPassword"
    ]
  },
  accountCase: {
    control: "select",
    options: [
      "ready",
      "loading",
      "unavailable",
      "apiKey",
      "bedrock",
      "noLimits",
      "emptyLimits",
      "exhausted",
      "signingIn",
      "signingOut",
      "error"
    ]
  },
  providerCase: {
    control: "select",
    options: [
      "ready",
      "custom",
      "pending",
      "error",
      "saving",
      "testing",
      "invalidKey",
      "timeout",
      "network",
      "unsupported",
      "rateLimited"
    ]
  },
  updateCase: {
    control: "select",
    options: ["idle", "disabled", "checkingForUpdates", "downloading", "indeterminate", "ready", "restarting"]
  },
  voiceCase: {
    control: "select",
    options: ["disabled", "idle", "starting", "recording", "transcribing", "error", "unconfigured", "noSpeech"]
  },
  chatDetail: { control: "select", options: [undefined, "usage", "usageWarning", "usageFull", "fork"] },
  accountSignedIn: { control: "boolean" },
  companyAccount: { control: "boolean" },
  emptyThreads: { control: "boolean" },
  emptyFiles: { control: "boolean" },
  authenticated: { control: "boolean" },
  authError: { control: "select", options: [null, "WAITLISTED", "DISABLED"] },
  draftFailure: { control: "text" },
  width: { control: { type: "number", min: 420, max: 1920, step: 20 } },
  paletteOpen: { control: "boolean" },
  hotkeysOpen: { control: "boolean" }
} satisfies Partial<ArgTypes<ProductPreviewProps>>
