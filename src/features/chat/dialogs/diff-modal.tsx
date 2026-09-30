// Ported from ALwith Desktop's diff-modal.tsx. Desktop shows original/modified in Monaco;
// Codex hands us git patches, so the modal renders the same `PatchView` the tool rows use,
// scoped to one file when the patch touches several.
import { useTranslation } from "react-i18next"
import { create } from "zustand"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { PatchView, patchStats } from "../codex/patch-view"

export type DiffModalRequest = { path: string; patch: string }

const useDiffModal = create<{ request: DiffModalRequest | null }>(() => ({ request: null }))

/** Open the modal on the section of `patch` that belongs to `path`; the whole patch if it has no per-file headers. */
export function openDiffModal(request: DiffModalRequest): void {
  useDiffModal.setState({ request: { path: request.path, patch: filePatch(request.patch, request.path) } })
}

/** The `diff --git` section for one path; the full text when the patch is not split per file. */
export function filePatch(patch: string, path: string): string {
  const sections = patch.split(/^(?=diff --git )/m).filter(section => section.length > 0)
  if (sections.length <= 1) return patch
  const wanted = sections.find(section => {
    const header = section.split("\n", 1)[0] ?? ""
    return header.endsWith(` b/${path}`) || header.endsWith(` ${path}`) || header.includes(`/${path} `)
  })
  return wanted ?? patch
}

export function DiffModal() {
  const { t } = useTranslation()
  const request = useDiffModal(state => state.request)
  const stats = request === null ? null : patchStats(request.patch)
  return (
    <Dialog open={request !== null} onOpenChange={open => !open && useDiffModal.setState({ request: null })}>
      <DialogContent className="flex h-[calc(100vh-2.5rem)] max-h-[900px] flex-col gap-3 sm:max-w-[min(1400px,calc(100vw-2.5rem))]">
        <DialogHeader>
          <DialogTitle className="truncate pe-8 font-mono text-sm font-normal">{request?.path}</DialogTitle>
          {stats !== null && (
            <DialogDescription>
              <span className="codex-diff-additions">+{stats.additions}</span>{" "}
              <span className="codex-diff-deletions">-{stats.deletions}</span>{" "}
              <span>{t("chat.files.changedLines")}</span>
            </DialogDescription>
          )}
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border" data-stream-style="codexUI">
          {request !== null && <PatchView patch={request.patch} />}
        </div>
      </DialogContent>
    </Dialog>
  )
}
