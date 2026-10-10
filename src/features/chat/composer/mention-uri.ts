/**
 * Mention URI codec, from ALwith Desktop (after Zed's `acp_thread/src/mention.rs`): a
 * user-referenced file becomes an ACP `resource_link` whose `uri` is `file://<path>`.
 * `encodeURI` keeps `/` readable and makes `parse` symmetric with `decodeURIComponent`.
 */
import { basename } from "@/lib/path"

export type MentionUri = { kind: "file"; absPath: string }

export function formatMentionUri(m: MentionUri): string {
  return `file://${encodeURI(m.absPath).replace(/[?#]/g, encodeURIComponent)}`
}

/** The `name` of the resource_link: the file name. */
export function mentionDisplayName(m: MentionUri): string {
  return basename(m.absPath)
}
