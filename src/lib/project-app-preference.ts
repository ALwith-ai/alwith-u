import { createStore } from "zustand/vanilla"

/** Shared by project-opening controls in this window; preferences remain the source of truth. */
export const projectAppPreference = createStore(() => ({ preferred: null as string | null, revision: 0 }))

export function setProjectAppPreference(preferred: string | null): void {
  projectAppPreference.setState(state => ({ preferred, revision: state.revision + 1 }))
}
