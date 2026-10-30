import { toast } from "sonner"
import type { LoaderFunction } from "storybook/internal/types"

import { wallpaperController } from "../../src/features/appearance/wallpaper/controller"
import { navigationSoundStore } from "../../src/features/chat/codex/navigation-sound-store"
import { drafts } from "../../src/features/chat/composer/drafts"
import { predictionPreference } from "../../src/features/chat/composer/prediction-preference"
import { pluginsStore } from "../../src/features/plugins/instance"
import { createPluginsStore } from "../../src/features/plugins/store"
import { useThreadsUiStore } from "../../src/features/threads/store"
import { settingsStore } from "../../src/lib/settings-store"
import { zoomStore } from "../../src/lib/zoom"
import { type AuthCase, demoUser, resetAuth, usePlatformAuth } from "./auth"
import { type ChatCase, makeSession, pendingAction, PROJECT_DIRECTORY, QUICK_DIRECTORY } from "./catalog"
import { resetChatWindow } from "./chat-window"
import { client, resetClient, runState } from "./client"
import { type ComposerCase, resetComposer } from "./composer"
import { type DriveCase, resetDrive } from "./drive"
import { type ExtensionCase, resetExtensions } from "./extensions"
import { type FileCase, resetFiles } from "./filesystem"
import { type GamepadCase, resetGamepad } from "./gamepad"
import { installNativeMock, resetNative, setComputerStatus } from "./native"
import type { BubbleCase } from "./pet-session"
import { type PetCase, resetPets } from "./pets"
import { disposePlaybackClock } from "./playback-clock"
import { type PluginCase, type PluginOperation, resetPlugins } from "./plugins"
import { type AccountCase, resetAccount } from "./settings-bridge"
import { resetUpdater, type UpdateCase } from "./updater"

export interface PreviewState {
  bubbleCase?: BubbleCase
  gamepadCase?: GamepadCase
  platform?: "macos" | "windows" | "linux"
  globalAction?: "form" | "url" | "multipleForms"
  wallpaper?: "cover" | "contain" | "error"
  composerCase?: ComposerCase
  fileCase?: FileCase
  binaryFiles?: boolean
  page?: string
  chatCase?: ChatCase
  sidebarView?: "sessions" | "activity" | "drive"
  sidebarPinned?: boolean
  emptyThreads?: boolean
  connection?: "ready" | "connecting" | "disconnected" | "failed"
  pluginCase?: PluginCase
  pluginOperation?: PluginOperation
  extensionCase?: ExtensionCase
  driveCase?: DriveCase
  archiveCase?:
    | "list"
    | "empty"
    | "loading"
    | "many"
    | "loadError"
    | "restoring"
    | "restoreError"
    | "deleting"
    | "deleteError"
    | "partialDelete"
  extensionId?: string
  chatDetail?: "usage" | "usageWarning" | "usageFull" | "fork"
  authCase?: AuthCase
  accountCase?: AccountCase
  updateCase?: UpdateCase
  voiceCase?: import("./voice").VoiceCase
  providerCase?: import("./native").ProviderCase
  authError?: string | null
  authenticated?: boolean
  accountSignedIn?: boolean
  companyAccount?: boolean
  response?: "complete" | "permission" | "question" | "error"
  draftFailure?: string | null
  file?: string | null
  emptyFiles?: boolean
  computerCase?: "enabled" | "disabled" | "permissions" | "unavailable"
  petCase?: PetCase
  settingsSection?: string
}
let stopPlugins = () => {}

export const preparePreview: LoaderFunction = async ({ args }) => {
  toast.dismiss()
  disposePlaybackClock()
  const state = args as PreviewState
  resetNative(state.providerCase, state.voiceCase)
  resetGamepad(state.gamepadCase)
  installNativeMock(state.platform)
  zoomStore.setState({ level: 1, interaction: 0 })
  wallpaperController.bind().show(
    state.wallpaper
      ? {
          url: state.wallpaper === "error" ? "wallpaper:storybook-missing" : "wallpaper:storybook",
          fit: state.wallpaper === "contain" ? "contain" : "cover",
          brightness: 90,
          blur: 2
        }
      : null
  )
  resetChatWindow(
    state.chatCase && !["welcome", "project"].includes(state.chatCase) ? state.chatCase : null,
    state.chatCase === "welcome" ? null : PROJECT_DIRECTORY
  )
  resetClient({ connection: state.connection, response: state.response, draftFailure: state.draftFailure })
  resetAuth(state.authenticated ?? state.page !== "login", state.authError, state.authCase)
  await resetPets(state.petCase, state.bubbleCase)
  if (state.companyAccount === false)
    usePlatformAuth.setState({ user: { ...demoUser, login_email: "lin.ran@example.test" } })
  for (const key of Object.keys(localStorage)) if (key.startsWith("workspace:")) localStorage.removeItem(key)
  await resetFiles(state.emptyFiles, state.binaryFiles, state.fileCase)
  resetComposer(state.composerCase)
  predictionPreference.setState({ enabled: true })
  resetDrive(state.driveCase)
  resetPlugins(state.pluginCase, state.pluginOperation)
  stopPlugins()
  const previewPlugins = createPluginsStore(client)
  pluginsStore.setState(previewPlugins.getState(), true)
  stopPlugins = previewPlugins.subscribe((next) => pluginsStore.setState(next, true))
  if (state.pluginCase !== "loading") await pluginsStore.getState().refresh()
  await resetExtensions(state.extensionCase)
  await resetAccount(state.accountSignedIn, state.accountCase)
  resetUpdater(state.updateCase)
  await settingsStore.read()
  const url = new URL(window.location.href)
  if (state.page === "settings") url.searchParams.set("tab", state.settingsSection ?? "general")
  else url.searchParams.delete("tab")
  history.replaceState(null, "", url)
  navigationSoundStore.setState({ soundMode: "none" })
  drafts.clear()
  useThreadsUiStore.setState({
    view: state.sidebarView ?? "sessions",
    projectOpen: new Map([
      [PROJECT_DIRECTORY, true],
      [QUICK_DIRECTORY, true]
    ]),
    revealed: new Map(),
    activitySeen: new Map(),
    activityCollapsedGroups: new Set()
  })
  if (state.chatCase && state.chatCase !== "welcome" && state.chatCase !== "project") {
    let session = makeSession(state.chatCase)
    if (state.composerCase === "prediction" || state.composerCase === "predictionError") {
      session = { ...session, state: "idle", lastStopReason: "end_turn" }
      client.store.setState((previous) => ({
        agent: previous.agent && {
          ...previous.agent,
          capabilities: {
            ...previous.agent.capabilities,
            _meta: { codex: { ...(previous.agent.capabilities?._meta?.codex as object), composerPredictions: true } }
          }
        }
      }))
    }
    if (state.chatDetail?.startsWith("usage"))
      session = {
        ...session,
        usage: {
          used: state.chatDetail === "usageFull" ? 128000 : state.chatDetail === "usageWarning" ? 110000 : 42000,
          size: 128000
        },
        lastTurnUsage: {
          inputTokens: 2400,
          outputTokens: 1250,
          cachedReadTokens: 8000,
          cachedWriteTokens: 0,
          totalTokens: 11650
        }
      }
    if (state.chatDetail === "fork")
      client.store.setState({
        forkOrigins: { [session.id]: { sourceId: "conversation", boundaryTurnId: `turn:${session.id}-user` } }
      })
    client.store.setState((previous) => ({ sessions: { ...previous.sessions, [session.id]: session } }))
    if (["permission", "form", "url"].includes(state.chatCase))
      client.store.setState({ actions: [pendingAction(state.chatCase as "permission" | "form" | "url", session.id)] })
    if (["running", "reasoning", "tools", "plan", "question"].includes(state.chatCase))
      client.store.setState((previous) => ({
        runStates: { ...previous.runStates, [session.id]: runState(session.id, "running") }
      }))
  }
  if (state.globalAction) {
    const kind = state.globalAction === "multipleForms" ? "form" : state.globalAction
    const template = pendingAction(kind, "global")
    if (template.kind !== "elicitation") throw new Error("Global requests must use elicitation")
    const action = { ...template, sessionId: null }
    client.store.setState({
      actions: state.globalAction === "multipleForms" ? [action, { ...action, id: "global-form-2" }] : [action]
    })
  }
  if (state.emptyThreads) client.store.setState({ threads: [], runStates: {} })
  if (state.connection)
    client.store.setState({
      connection: state.connection,
      connectionError: state.connection === "failed" ? "无法连接到 Codex，请检查模型配置后重试。" : null,
      threadsLoaded: state.connection !== "connecting",
      threadsLoading: state.connection === "connecting"
    })
  if (state.archiveCase === "empty") client.store.setState({ archivedThreads: [] })
  if (state.archiveCase === "loading") client.listThreads = async () => new Promise(() => {})
  if (state.archiveCase === "loadError")
    client.listThreads = async () => {
      throw new Error("归档加载失败，请检查连接后重试。")
    }
  const remove = client.delete
  if (state.archiveCase === "restoring") client.unarchive = async () => new Promise(() => {})
  if (state.archiveCase === "restoreError")
    client.unarchive = async () => {
      throw new Error("恢复失败，请稍后重试。")
    }
  if (state.archiveCase === "deleting") client.delete = async () => new Promise(() => {})
  if (state.archiveCase === "deleteError")
    client.delete = async () => {
      throw new Error("删除失败，请稍后重试。")
    }
  if (state.archiveCase === "partialDelete") {
    const failedId = client.state.archivedThreads[0]?.sessionId
    client.delete = async (id) => {
      if (id === failedId) throw new Error("模拟单条删除失败")
      await remove(id)
    }
  }
  if (state.archiveCase === "many")
    client.store.setState((previous) => ({
      archivedThreads: Array.from({ length: 60 }, (_, index) => ({
        ...previous.archivedThreads[index % previous.archivedThreads.length]!,
        sessionId: `archived-${index}`
      }))
    }))
  if (state.computerCase === "enabled") setComputerStatus({ enabled: true })
  if (state.computerCase === "permissions")
    setComputerStatus({ permissions: { supported: true, accessibility: false, screenCapture: false } })
  if (state.computerCase === "unavailable") setComputerStatus({ available: false })
  return {}
}
