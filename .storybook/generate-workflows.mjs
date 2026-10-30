// Expand each source interaction into one connected, full-page workflow diagram.
// Run with Bun after editing flow definitions; generated CSF exports remain statically indexed.
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"

import { parse } from "../node_modules/@babel/parser/lib/index.js"
const root = path.join(import.meta.dirname, "stories")
const definitions = path.join(root, "flow-definitions")
const workflowNames = JSON.parse(await readFile(path.join(import.meta.dirname, "workflow-names.json"), "utf8"))
// Keep a separate completion checkpoint only when the last action produces a visibly distinct result.
// The rest would duplicate the final action checkpoint.
const completionCheckpointIds = new Set([
  "workflow-navigation-modules",
  "workflow-chat-senderror",
  "workflow-chat-send",
  "workflow-chat-quickchat",
  "workflow-chat-switchproject",
  "workflow-chat-searchchat",
  "workflow-requests-question",
  "workflow-input-recovery-filemention",
  "workflow-input-recovery-textattachmentretry",
  "workflow-input-recovery-prediction",
  "workflow-chat-details-states-warning",
  "workflow-chat-details-states-full",
  "workflow-files-states-newfiledialog",
  "workflow-files-states-deletedialog",
  "workflow-files-states-movedialog",
  "workflow-files-states-crossprojectmove",
  "workflow-files-states-unsaveddialog",
  "workflow-files-markdown",
  "workflow-file-operations-saveretry",
  "workflow-files-savetext",
  "workflow-files-maximize",
  "workflow-files-close",
  "workflow-files-cancelnewfile",
  "workflow-files-dirtydiscard",
  "workflow-files-dirtysave",
  "workflow-pets-draw",
  "workflow-pet-reply-send",
  "workflow-drive-surfaces-states-failed"
])
const unwrap = (node) =>
  node?.type === "TSSatisfiesExpression" || node?.type === "TSAsExpression" ? unwrap(node.expression) : node
const property = (node, name) =>
  unwrap(node)?.properties?.find((p) => p.key?.name === name || p.key?.value === name)?.value
function text(node, env = {}) {
  node = unwrap(node)
  if (!node) return ""
  if (node.type === "StringLiteral") return node.value
  if (node.type === "RegExpLiteral") return node.pattern.replace(/[\^$.*?()+\\]/g, "").split("|")[0]
  if (node.type === "Identifier") return typeof env[node.name] === "string" ? env[node.name] : ""
  return ""
}
function selector(node, variables, env, seen = new Set()) {
  node = unwrap(node)
  if (!node) return ""
  if (node.type === "Identifier" && !seen.has(node.name)) {
    seen.add(node.name)
    return selector(variables.get(node.name), variables, env, seen)
  }
  if (node.type === "AwaitExpression" || node.type === "TSNonNullExpression")
    return selector(node.argument ?? node.expression, variables, env, seen)
  if (node.type === "CallExpression" && node.callee.type === "MemberExpression") {
    const name = node.callee.property.name
    if (/ByRole$/.test(name))
      return (
        text(property(node.arguments[1], "name"), env) ||
        ({ textbox: "输入框", combobox: "搜索框", switch: "开关", tab: "标签页" }[text(node.arguments[0])] ?? "")
      )
    if (/ByLabelText$|ByPlaceholderText$|ByText$/.test(name)) return text(node.arguments[0], env)
    if (name === "querySelector") return text(node.arguments[0], env).includes("Vibémon") ? "Vibémon" : ""
    return selector(node.callee.object, variables, env, seen)
  }
  if (node.type === "MemberExpression") return selector(node.object, variables, env, seen)
  return ""
}
function actionLabels(play) {
  const variables = new Map()
  function collect(node) {
    if (!node || typeof node !== "object") return
    if (node.type === "VariableDeclarator" && node.id.type === "Identifier") variables.set(node.id.name, node.init)
    for (const value of Object.values(node))
      if (Array.isArray(value)) value.forEach(collect)
      else if (value && typeof value === "object") collect(value)
  }
  collect(play)
  const result = []
  function walk(node, env = {}) {
    if (!node || typeof node !== "object") return
    if (node.type === "ForOfStatement") {
      const values =
        node.right.type === "ArrayExpression" ? node.right.elements : variables.get(node.right.name)?.elements
      const key = node.left.declarations?.[0]?.id?.name
      if (!values || !key) throw new Error("Workflow loops require a literal array")
      for (const value of values) walk(node.body, { ...env, [key]: text(value, env) })
      return
    }
    if (node.type === "CallExpression") {
      if (node.callee.type === "Identifier" && node.callee.name === "workflowAction") {
        result.push(text(node.arguments[0], env))
        return
      }
      if (node.callee.type === "MemberExpression" && node.callee.object.name === "userEvent") {
        const method = node.callee.property.name
        const target = selector(node.arguments[0], variables, env)
        const key = text(node.arguments[0], env)
        result.push(
          method === "keyboard"
            ? ({ "{Meta>}s{/Meta}": "保存文件", "{Delete}": "关闭文件标签", "{Escape}": "关闭弹窗" }[key] ?? "键盘操作")
            : `${{ click: "点击", dblClick: "双击", type: "输入", clear: "清空", selectOptions: "选择" }[method] ?? method}${target ? ` · ${target}` : ""}`
        )
        return
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (["loc", "start", "end", "extra"].includes(key)) continue
      if (Array.isArray(value)) value.forEach((v) => walk(v, env))
      else if (value && typeof value === "object") walk(value, env)
    }
  }
  walk(play)
  return result
}
let flows = 0,
  pages = 0
const emitted = new Set()
for (const filename of (await readdir(definitions)).filter((name) => name.endsWith(".tsx")).sort()) {
  const source = await readFile(path.join(definitions, filename), "utf8")
  const ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] })
  const objects = new Map()
  for (const statement of ast.program.body) {
    const declaration = statement.type === "ExportNamedDeclaration" ? statement.declaration : statement
    for (const item of declaration?.declarations ?? [])
      if (item.id.type === "Identifier") objects.set(item.id.name, unwrap(item.init))
  }
  function resolved(node) {
    const value = {}
    for (const item of node?.properties ?? []) {
      if (item.type === "SpreadElement") Object.assign(value, resolved(objects.get(item.argument.name)))
      else value[item.key.name ?? item.key.value] = item.value
    }
    return value
  }
  const base = resolved(objects.get("meta"))
  const category = text(base.title).replace(/^流程\//, "")
  let ordinal = 0
  for (const statement of ast.program.body) {
    if (statement.type !== "ExportNamedDeclaration") continue
    for (const item of statement.declaration?.declarations ?? []) {
      const name = item.id.name
      const story = resolved(objects.get(name))
      const label = text(story.name)
      if (!label) continue
      ordinal++
      const actions = story.play ? actionLabels(story.play) : []
      // Pure states remain under Pages. A workflow must perform a source interaction.
      if (!actions.length) continue
      const module = filename.replace(".tsx", "")
      const id = `workflow-${module}-${name.toLowerCase()}`
      const labels = [`初始页面 · ${label.split("→")[0].trim()}`, ...actions]
      if (completionCheckpointIds.has(id)) labels.push(`完成 · ${label.split("→").at(-1).trim()}`)
      const workflowName = workflowNames[module]?.[name.toLowerCase()]
      if (typeof workflowName !== "string" || !workflowName.trim() || workflowName.includes("→"))
        throw new Error(`A concise workflow name is required for ${id}`)
      const storyCategory =
        module === "chat" && ["floating", "transferdraft"].includes(name.toLowerCase())
          ? "浮窗聊天/聊天窗口切换"
          : module === "plugins" && name.toLowerCase().startsWith("extension")
            ? "负一屏/扩展"
            : category
      const title = `流程/${storyCategory}/${String(ordinal).padStart(2, "0")} ${workflowName}`
      const directory = path.join(root, "flows", module)
      await mkdir(directory, { recursive: true })
      const output = `// Generated by .storybook/generate-workflows.mjs from the source interaction definition.\nimport type { Meta } from "@storybook/react-vite"\nimport base, { ${name} as source } from "../../flow-definitions/${module}"\nimport { prepareWorkflow, workflowStory } from "../../workflow-driver"\nimport { WorkflowPreview } from "../../workflow-preview"\n\nconst labels = ${JSON.stringify(labels)}\nconst config = { labels, id: ${JSON.stringify(id)} }\nconst meta = {\n  ...base,\n  id: ${JSON.stringify(id)},\n  title: ${JSON.stringify(title)},\n  loaders: [prepareWorkflow],\n  render: (args, context) => <WorkflowPreview args={args} config={context.parameters.workflow} globals={context.globals} Preview={base.component} />,\n  tags: ["!autodocs"],\n} satisfies Meta<typeof base.component>\nexport default meta\n\nexport const Sequence = { ...workflowStory(source, { ...config, target: null }), name: "完整流程图" }\n`
      await writeFile(path.join(directory, `${name.toLowerCase()}.stories.tsx`), output)
      emitted.add(path.join(directory, `${name.toLowerCase()}.stories.tsx`))
      flows++
      pages += labels.length
    }
  }
}
// Remove only obsolete files owned by this generator, never hand-authored stories.
for (const module of await readdir(path.join(root, "flows"), { withFileTypes: true })) {
  if (!module.isDirectory()) continue
  const directory = path.join(root, "flows", module.name)
  for (const name of await readdir(directory)) {
    const file = path.join(directory, name)
    if (
      !emitted.has(file) &&
      (await readFile(file, "utf8")).startsWith("// Generated by .storybook/generate-workflows.mjs")
    )
      await rm(file)
  }
}
console.log(`${flows} connected workflow diagrams; ${pages} embedded steps; ${flows} flow stories`)
