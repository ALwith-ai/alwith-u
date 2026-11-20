import { isDriveFileLink } from "@/features/drive/files"
import { resolveChatDriveFile } from "@/lib/chat-window"
import { openExternal, openLocalPath } from "@/lib/open"

export async function openChatWindowFile(path: string, sessionId: string | null): Promise<void> {
  if (!isDriveFileLink(path)) return openLocalPath(path)
  const target = await resolveChatDriveFile(sessionId, path)
  if (target?.type === "file") await openLocalPath(target.path)
  else if (target?.type === "web") await openExternal(target.url)
}
