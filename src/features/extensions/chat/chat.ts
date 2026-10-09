import { assertAvailableSkills } from "./skills"

interface ChatDependencies {
  check?(): void
  session(id: string): { cwd: string } | null
  skills(cwd: string): Promise<readonly { name: string; enabled: boolean; path: string }[]>
  present(id: string): void
  writeDraft?(id: string, text: string): void
  prompt(id: string, text: string): Promise<void>
}

/** Keep the destination explicit across catalog discovery and prompt acceptance. */
async function dispatchMessage(
  id: string,
  text: string,
  required: string[],
  dependencies: ChatDependencies,
  deliver: (prompt: string) => void | Promise<void>
): Promise<void> {
  dependencies.check?.()
  const session = dependencies.session(id)
  if (!session) throw new Error("目标会话当前不可写，请先返回聊天并打开该会话后重试")
  let prompt = text
  if (required.length) {
    const names = assertAvailableSkills(required, await dependencies.skills(session.cwd))
    for (const [index, name] of required.entries()) prompt = prompt.replaceAll(`${name} skill`, `${names[index]} skill`)
  }
  dependencies.check?.()
  const current = dependencies.session(id)
  if (!current || current.cwd !== session.cwd) throw new Error("目标会话已变化，请返回聊天确认会话后重试")
  await deliver(prompt)
}

export async function sendExtensionMessage(
  id: string,
  text: string,
  required: string[],
  dependencies: ChatDependencies
): Promise<void> {
  await dispatchMessage(id, text, required, dependencies, async prompt => {
    dependencies.present(id)
    await dependencies.prompt(id, prompt)
  })
}

export async function setExtensionDraft(
  id: string,
  text: string,
  required: string[],
  dependencies: ChatDependencies
): Promise<void> {
  if (typeof text !== "string" || !text.trim()) throw new Error("草稿内容不能为空")
  await dispatchMessage(id, text, required, dependencies, prompt => {
    if (!dependencies.writeDraft) throw new Error("当前宿主不支持草稿写入")
    dependencies.writeDraft(id, prompt)
    dependencies.present(id)
  })
}
