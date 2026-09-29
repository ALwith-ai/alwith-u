// Sidebar UI state, reduced from ALwith Desktop's `features/sessions/store.ts` and the
// `activeNavigationItem` of its layout store: which panel the sidebar shows and the
// group open states. All of it lives in process memory only (kept while the app runs,
// cleared on restart), exactly as Desktop's `projectOpen` / `activityCollapsedGroups`.
import { create } from "zustand"

/** Desktop's `NavigationItemId`, reduced to the two panels this client has. */
export type SidebarView = "sessions" | "activity"

interface ThreadsUiState {
  /** Current sidebar panel: session list or activity. */
  view: SidebarView
  setView: (view: SidebarView) => void
  /** Project expansion state lives only in process memory and resets on app restart. */
  projectOpen: Map<string, boolean>
  setProjectOpen: (next: Map<string, boolean>) => void
  /** Collapsed Activity groups (foreground / background); preserved across panel switches, reset on restart. */
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
