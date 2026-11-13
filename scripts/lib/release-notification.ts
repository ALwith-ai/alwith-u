import { releaseArtifacts, releaseVersion } from "./release-artifacts"

export async function notifyRelease(
  directory: string,
  tag: string,
  webhook: string,
  request: typeof fetch = fetch
): Promise<void> {
  if (!webhook) throw new Error("Missing LARK_ROBOT_URL")
  const version = releaseVersion(tag)
  const actions = releaseArtifacts(directory, tag)
    .filter((artifact) => artifact.format !== "tar.gz")
    .map((artifact) => ({
      tag: "button",
      text: {
        tag: "plain_text",
        content:
          artifact.target === "darwin" ? `macOS ${artifact.label}` : `Windows ${artifact.label} (${artifact.format})`
      },
      url: artifact.download_url,
      type: "default"
    }))
  const payload = {
    msg_type: "interactive",
    card: {
      header: {
        title: { tag: "plain_text", content: `ALwith U ${version} 发布产物已上传到 TOS` },
        template: "green"
      },
      elements: [
        {
          tag: "div",
          text: { tag: "lark_md", content: `**版本：** ${version}\n**状态：** 产物已上传并登记后台，待发布` }
        },
        { tag: "hr" },
        { tag: "div", text: { tag: "lark_md", content: "**下载地址**" } },
        { tag: "action", actions }
      ]
    }
  }
  let response: Response
  try {
    response = await request(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
      redirect: "error"
    })
  } catch {
    throw new Error("Feishu notification request failed")
  }
  if (!response.ok) throw new Error(`Feishu notification failed: HTTP ${response.status}`)
  const result: unknown = await response.json()
  if (!result || typeof result !== "object" || !("code" in result) || result.code !== 0) {
    throw new Error("Feishu notification rejected or returned an invalid response")
  }
}
