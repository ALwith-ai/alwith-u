import type {
  DriveController,
  DriveResponse,
  DriveState,
  DriveTransport,
  FailedUpload,
  GrantList,
  Job,
  RootInfo,
  Snapshot
} from "@alwith/module-drive"

import { OTHER_DIRECTORY, PROJECT_DIRECTORY } from "./catalog"

let preferences = { sessionArchive: true, knowledgeInject: true }
const listeners = new Set<() => void>()
let state: DriveState = { connected: true, snapshot: null, error: null }
let mode: DriveCase = "ready"
let generation = 0
let grantList: GrantList = { grants: [], implicit: [], callerLevel: "MANAGE" }
let currentJob: Job = {
  id: 1,
  status: "PENDING",
  type: "CONDENSE",
  projectId: 1,
  progress: 0,
  message: null,
  error: null,
  result: null
}
const failures: FailedUpload[] = [
  {
    projectId: 1,
    path: "docs/交付清单.md",
    localPath: `${PROJECT_DIRECTORY}/docs/交付清单.md`,
    name: "交付清单.md",
    state: "error",
    message: "模拟上传网络超时",
    attempts: 3,
    direction: "upload",
    firstAt: "2026-10-23T04:00:00Z",
    lastAt: "2026-10-23T04:10:00Z",
    nextAttemptAt: "2026-10-23T04:15:00Z",
    retryable: true
  }
]
export type DriveCase =
  | "ready"
  | "empty"
  | "unconfigured"
  | "offline"
  | "error"
  | "paused"
  | "syncing"
  | "failedUploads"
  | "conflict"
  | "massDelete"
  | "deleteError"
  | "sharing"
  | "sharingReadOnly"
  | "sharingError"
  | "condenseUnsynced"
  | "condenseRunning"
  | "condenseDone"
  | "condenseError"
  | "condenseProposed"
export function resetDrive(kind: DriveCase = "ready"): void {
  mode = kind
  grantList = {
    callerLevel: kind === "sharingReadOnly" ? "VIEW" : "MANAGE",
    grants: [
      {
        subjectType: "USER",
        subjectId: "demo-colleague",
        subjectDisplay: "周宁",
        level: "EDIT",
        actions: [],
        source: "FOLDER",
        sourceResourceId: null,
        sourceDisplay: null,
        inherited: false,
        editable: true
      },
      {
        subjectType: "DEPT",
        subjectId: 1,
        subjectDisplay: "产品与研发",
        level: "VIEW",
        actions: [],
        sourceResourceId: 1,
        source: "SPACE",
        sourceDisplay: "团队空间",
        inherited: true,
        editable: false
      }
    ],
    implicit: [{ subjectDisplay: "林然", level: "MANAGE", reason: "OWNER" }]
  }
  currentJob = {
    id: ++generation,
    projectId: 1,
    type: "CONDENSE",
    status:
      kind === "condenseRunning"
        ? "RUNNING"
        : kind === "condenseDone"
          ? "SUCCEEDED"
          : kind === "condenseError"
            ? "FAILED"
            : kind === "condenseProposed"
              ? "PROPOSED"
              : "PENDING",
    progress: 42,
    message: "正在归纳项目资料",
    error: kind === "condenseError" ? "模拟归纳任务失败，请重试。" : null,
    result:
      kind === "condenseDone"
        ? {
            knowledgeFileId: 18,
            knowledgeTitle: "项目交付经验",
            sourcesLinked: 8,
            humanUrl: "https://example.test/knowledge/18"
          }
        : null
  }
  preferences = { sessionArchive: true, knowledgeInject: true }
  const roots: RootInfo[] =
    kind === "empty"
      ? []
      : ["产品资料库", "品牌网站", "项目方法库"].map((name, index) => ({
          projectId: index + 1,
          projectKey: `project-${index}`,
          name,
          kind: "MATERIAL",
          scope: index === 2 ? "COMPANY" : "PERSONAL",
          deptName: null,
          drivePath: `我的空间/${name}`,
          node: "PERSONAL",
          container: "MATERIAL",
          nodePath: "我的空间",
          skillsPath: null,
          syncEnabled: true,
          canWrite: true,
          cloudOnly: false,
          cursor: "1",
          pinned: index === 0,
          departmentId: null,
          ownerId: null,
          isMine: true,
          localPath: index === 1 ? OTHER_DIRECTORY : index === 2 ? `${PROJECT_DIRECTORY}/docs` : PROJECT_DIRECTORY,
          selected: true
        }))
  const snapshot: Snapshot = {
    version: 1,
    generation,
    sequence: 1,
    configured: kind !== "unconfigured",
    running: kind !== "paused" && kind !== "unconfigured",
    baseUrl: "https://api.example.test",
    localRoot: "/Users/demo/Drive",
    webBaseUrl: "https://example.test",
    status: {
      state: { kind: kind === "paused" ? "paused" : kind === "syncing" ? "syncing" : "idle" },
      pending: kind === "syncing" ? 8 : 0,
      uploading: kind === "syncing" ? 2 : 0,
      downloading: kind === "syncing" ? 1 : 0,
      synced: 128,
      failed: kind === "failedUploads" ? 1 : 0,
      conflicts:
        kind === "conflict"
          ? [
              {
                projectId: 1,
                path: "README.md",
                localPath: `${PROJECT_DIRECTORY}/README.md`,
                conflictCopyPath: `${PROJECT_DIRECTORY}/README.conflict.md`,
                remoteUpdatedBy: "周宁",
                at: "2026-10-23T04:00:00Z"
              }
            ]
          : [],
      errors: [],
      lastSyncAt: "2026-10-23T04:00:00Z",
      pushConnected: true
    },
    roots,
    files: [],
    projects: [],
    pendingDeletes:
      kind === "massDelete" || kind === "deleteError"
        ? [{ projectId: 1, drivePath: "我的空间/产品资料库", count: 28 }]
        : [],
    error: kind === "error" ? "连接暂时中断，请检查网络后重试。" : null
  }
  state = { connected: kind !== "offline", snapshot, error: kind === "error" ? snapshot.error : null }
  for (const listener of listeners) listener()
}
export const drive: DriveController = {
  getSnapshot: () => state,
  subscribe: (listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  attach: async () => {},
  refresh: async () => {},
  dispose: () => {},
  request: async (request): Promise<DriveResponse> => {
    if (request.type === "collabSession") return { type: "collabSession", data: null }
    if (request.type === "commentContext") return { type: "commentContext", data: null }
    if (request.type === "proposedCondense")
      return { type: "jobs", data: mode === "condenseProposed" ? [currentJob] : [] }
    if (request.type === "condensePreflight")
      return {
        type: "unsynced",
        data: {
          pending: mode === "condenseUnsynced" ? 3 : 0,
          failed: mode === "condenseUnsynced" ? 1 : 0,
          paths: mode === "condenseUnsynced" ? ["README.md", "docs/交付清单.md", "notes.txt"] : []
        }
      }
    if (request.type === "condenseStart" || request.type === "job") return { type: "job", data: currentJob }
    if (request.type === "approveJob") {
      currentJob = { ...currentJob, status: "RUNNING" }
      return { type: "done" }
    }
    if (request.type === "cancelJob") {
      currentJob = { ...currentJob, status: "CANCELLED" }
      return { type: "done" }
    }
    if (request.type === "localPath") return { type: "path", data: `${PROJECT_DIRECTORY}/docs/交付清单.md` }
    if (request.type === "archiveStatus")
      return {
        type: "archiveStatus",
        data: {
          enabled: true,
          syncing: false,
          lastRunAt: "2026-10-23T04:00:00Z",
          lastUploadAt: "2026-10-23T04:00:00Z",
          synced: 12,
          lastUploaded: 2,
          lastError: null,
          mode: "automatic"
        }
      }
    if (request.type === "confirmDeletes" || request.type === "cancelDeletes") {
      if (mode === "deleteError") throw new Error("模拟删除确认失败，请重试。")
      state = { ...state, snapshot: { ...state.snapshot!, pendingDeletes: [] } }
      for (const listener of listeners) listener()
      return { type: "done" }
    }
    if (request.type === "snapshot") return { type: "snapshot", data: state.snapshot! }
    if (request.type === "preferences") return { type: "preferences", data: preferences }
    if (request.type === "setPreferences") {
      preferences = { sessionArchive: request.sessionArchive, knowledgeInject: request.knowledgeInject }
      return { type: "preferences", data: preferences }
    }
    if (request.type === "roots") return { type: "roots", data: state.snapshot!.roots }
    if (request.type === "templates")
      return {
        type: "templates",
        data: [
          {
            id: 1,
            name: "项目资料库",
            kind: "MATERIAL",
            builtin: true,
            code: "material",
            description: null,
            icon: null
          },
          { id: 2, name: "知识库", kind: "KNOWLEDGE", builtin: true, code: "knowledge", description: null, icon: null }
        ]
      }
    if (request.type === "departments" || request.type === "searchDepartments")
      return {
        type: "departments",
        data: [{ id: 1, name: "产品与研发", code: "PRODUCT", parentId: null, type: "DEPARTMENT", path: "/PRODUCT" }]
      }
    if (request.type === "cloudFolders") return { type: "cloudFolders", data: [] }
    if (request.type === "failedUploads")
      return { type: "failedUploads", data: mode === "failedUploads" ? failures : [] }
    if (request.type === "diskUsage")
      return { type: "diskUsage", data: { totalBytes: 24140, totalFiles: 11, projects: [], files: [] } }
    if (request.type === "archivePrivateSessions") return { type: "archivePrivateSessions", data: [] }
    if (request.type === "grantTarget") return { type: "grantTarget", data: { kind: "FOLDER", id: 1 } }
    if (request.type === "grants") {
      if (mode === "sharingError") throw new Error("模拟权限列表加载失败")
      return { type: "grants", data: grantList }
    }
    if (request.type === "removeGrant") {
      grantList = {
        ...grantList,
        grants: grantList.grants?.filter(
          (grant) => !(grant.subjectType === request.subjectType && grant.subjectId === request.subjectId)
        )
      }
      return { type: "done" }
    }
    if (request.type === "setGrant") {
      const input = request.request
      grantList = {
        ...grantList,
        grants: [
          ...(grantList.grants ?? []).filter(
            (grant) => !(grant.subjectType === input.subjectType && grant.subjectId === input.subjectId)
          ),
          {
            subjectType: input.subjectType,
            subjectId: input.subjectId,
            level: input.level,
            subjectDisplay: input.subjectId === "demo-reviewer" ? "陈晓" : "周宁",
            actions: [],
            source: "FOLDER",
            sourceResourceId: null,
            sourceDisplay: null,
            inherited: false,
            editable: true
          }
        ]
      }
      return {
        type: "grantWrite",
        data: { kind: "applied", list: grantList }
      }
    }
    if (request.type === "pin") {
      state = {
        ...state,
        snapshot: {
          ...state.snapshot!,
          roots: state.snapshot!.roots.map((root) =>
            root.projectId === request.projectId ? { ...root, pinned: request.pinned } : root
          )
        }
      }
      for (const listener of listeners) listener()
      return { type: "done" }
    }
    if (request.type === "pause") {
      state = {
        ...state,
        snapshot: {
          ...state.snapshot!,
          running: !request.paused,
          status: {
            state: { kind: request.paused ? "paused" : "idle" },
            pending: 0,
            uploading: 0,
            downloading: 0,
            synced: 11,
            failed: 0,
            conflicts: [],
            errors: [],
            lastSyncAt: null,
            pushConnected: true
          }
        }
      }
      for (const listener of listeners) listener()
      return { type: "done" }
    }
    if (request.type === "createProject") {
      const name = request.request.name
      const id = state.snapshot!.roots.length + 10
      const root: RootInfo = {
        projectId: id,
        projectKey: `project-${id}`,
        name,
        kind: request.request.templateId === 2 ? "KNOWLEDGE" : "MATERIAL",
        scope: request.request.scope,
        deptName: null,
        drivePath: `我的空间/${name}`,
        node: "PERSONAL",
        container: "MATERIAL",
        nodePath: "我的空间",
        skillsPath: null,
        syncEnabled: true,
        canWrite: true,
        cloudOnly: false,
        cursor: "1",
        pinned: false,
        departmentId: null,
        ownerId: "storybook-user",
        isMine: true,
        localPath: `${PROJECT_DIRECTORY}/${name}`,
        selected: true
      }
      state = { ...state, snapshot: { ...state.snapshot!, roots: [...state.snapshot!.roots, root] } }
      for (const listener of listeners) listener()
      return { type: "root", data: root }
    }
    if (request.type === "file") return { type: "file", data: null }
    if (request.type === "configuration")
      return {
        type: "configuration",
        data: { userId: "storybook-user", deviceId: "storybook-device", userName: "林然", clientConfig: null }
      }
    if (request.type === "shared") return { type: "shared", data: [] }
    if (request.type === "ownershipGuard")
      return {
        type: "ownershipGuard",
        data: { unknownPersonalRoots: 0, threshold: 10, syncAllPersonal: false, active: false }
      }
    if (request.type === "maxAutoDownloadMb") return { type: "maxAutoDownloadMb", data: 50 }
    if (request.type === "setMaxAutoDownloadMb") return { type: "maxAutoDownloadMb", data: request.megabytes }
    if (request.type === "start" || request.type === "stop") {
      state = { ...state, snapshot: { ...state.snapshot!, running: request.type === "start" } }
      for (const listener of listeners) listener()
      return { type: "done" }
    }
    if (request.type === "searchUsers")
      return {
        type: "users",
        data: [
          { id: "demo-colleague", name: "周宁", employeeNo: "DEMO002" },
          { id: "demo-reviewer", name: "陈晓", employeeNo: "DEMO003" }
        ]
      }
    if (
      [
        "refreshClientConfig",
        "sync",
        "syncProject",
        "retryUpload",
        "retryUploads",
        "reconcile",
        "land",
        "confirmDeletes",
        "cancelDeletes",
        "removeGrant",
        "syncAllPersonal",
        "setArchivePrivate",
        "collabEnd",
        "commentWatch"
      ].includes(request.type)
    )
      return { type: "done" }
    throw new Error(`Unimplemented Storybook Drive request: ${request.type}`)
  }
}
export const driveTransport: DriveTransport = { request: drive.request, subscribe: async () => () => {} }
