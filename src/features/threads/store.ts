// Sidebar UI state, reduced from ALwith Desktop's `features/sessions/store.ts` and the
// `activeNavigationItem` of its layout store: which panel the sidebar shows and the
// group open states. All of it lives in process memory only (kept while the app runs,
// cleared on restart), exactly as Desktop's `projectOpen` / `activityCollapsedGroups`.
import { create } from "zustand"

/** Desktop's `NavigationItemId`, reduced to the two panels this client has. */
export type SidebarView = "sessions" | "activity"

interface ThreadsUiState {
  /** 当前侧栏面板:会话列表 / 活动。 */
  view: SidebarView
  setView: (view: SidebarView) => void
  /** Projects 展开态仅存进程内存;应用重启即清空。 */
  projectOpen: Map<string, boolean>
  setProjectOpen: (next: Map<string, boolean>) => void
  /** Activity 面板折叠的分组(前台 / 后台)。切走再回来保持,重启后清空。 */
  activityCollapsedGroups: ReadonlySet<string>
  setActivityCollapsedGroups: (next: ReadonlySet<string>) => void
}

export const useThreadsUiStore = create<ThreadsUiState>(set => ({
  view: "sessions",
  setView: view => set({ view }),
  projectOpen: new Map(),
  setProjectOpen: next => set({ projectOpen: next }),
  activityCollapsedGroups: new Set(),
  setActivityCollapsedGroups: next => set({ activityCollapsedGroups: next })
}))
