import type * as acp from "@agentclientprotocol/sdk/experimental/v2/unstable"
import { isText } from "@alwith/module-chat/client"

/** Narrows a prompt block a test expects to be text and returns its content. */
export function promptText(block: acp.ContentBlock | undefined): string {
  if (block === undefined || !isText(block)) throw new Error("Expected a text prompt block")
  return block.text
}
