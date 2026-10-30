import type { NativeRequest } from "@alwith/module-fs/tauri"

import { OTHER_DIRECTORY, PROJECT_DIRECTORY, QUICK_DIRECTORY } from "./catalog"

export const sampleFiles: Record<string, string> = {
  "README.md":
    "# 产品工作台\n\n用于管理项目交付、文件和团队协作。\n\n## 本周目标\n\n- [x] 梳理全部页面\n- [x] 补充聊天与项目场景\n- [ ] 复核文件预览\n\n| 模块 | 负责人 | 进度 |\n| --- | --- | --- |\n| 页面与交互 | 林然 | 80% |\n| 文件工作区 | 周可 | 65% |\n\n> 这是一份用于 Storybook 的模拟项目资料。\n",
  "docs/交互说明.md":
    "# 交互说明\n\n## 新建聊天\n\n选择项目后输入任务，消息与文件共同构成交付记录。\n\n## 文件工作区\n\n打开文件后可以切换预览和源码，拖动中间的分隔条调整宽度。\n",
  "docs/交付清单.md":
    "# 交付清单\n\n- 页面梳理：已完成\n- 交互验证：已完成\n- 文件预览：待复核\n\n## 验收要点\n\n所有页面直接使用当前源码组件。\n",
  "src/dashboard.tsx":
    "import { useState } from 'react'\n\nexport function Dashboard() {\n  const [selected, setSelected] = useState('overview')\n  return <main aria-label={selected}>产品工作台</main>\n}\n",
  "data/projects.json": JSON.stringify(
    [
      { name: "产品工作台", owner: "林然", progress: 80 },
      { name: "品牌网站", owner: "周可", progress: 65 }
    ],
    null,
    2
  ),
  "data/tasks.csv": "模块,负责人,进度\n页面与交互,林然,80\n文件工作区,周可,65\n品牌网站,陈文,55\n",
  "assets/brand.svg":
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" rx="24" fill="#edf2f7"/><rect x="48" y="48" width="544" height="56" rx="12" fill="#d8e0eb"/><rect x="48" y="128" width="160" height="184" rx="12" fill="#d8e0eb"/><rect x="232" y="128" width="360" height="184" rx="12" fill="#fff"/><text x="264" y="232" font-family="sans-serif" font-size="28" fill="#344054">ALwith U</text></svg>',
  "preview.html":
    '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>产品工作台</title><style>body{font-family:system-ui;margin:48px;color:#273142;background:#f5f7fa}article{padding:32px;background:white;border-radius:16px}h1{font-size:28px}p{line-height:1.8}</style><article><h1>产品工作台</h1><p>本周交付进度 80%</p><p>页面、交互和项目文件共同组成一个完整的工作记录。</p></article></html>',
  "notes.txt": "本周会议记录\n负责人：林然\n\n1. 完成页面梳理\n2. 验证主要交互\n3. 更新交付资料\n",
  ".gitignore": "node_modules/\ndist/\n"
}
export type FileCase = "ready" | "saveError" | "savePending" | "readError" | "moveError" | "deleteError" | "createError"
let mode: FileCase = "ready"
const binaryAssets = new Map<string, Uint8Array>()
export const virtualFiles = new Map<string, Uint8Array>()
const folders = new Set<string>()
let version = 1
export async function resetFiles(empty = false, binary = false, kind: FileCase = "ready"): Promise<void> {
  mode = kind
  if (binary && !binaryAssets.size) {
    for (const name of ["sample.pdf", "sample.docx", "sample.xlsx", "sample.tiff", "sample.wav", "sample.webm"]) {
      const response = await fetch(`/storybook-fixtures/${name}`)
      if (!response.ok) throw new Error(`Missing synthetic preview asset: ${name}`)
      binaryAssets.set(`samples/${name}`, new Uint8Array(await response.arrayBuffer()))
    }
  }
  virtualFiles.clear()
  folders.clear()
  version++
  for (const root of [PROJECT_DIRECTORY, OTHER_DIRECTORY, QUICK_DIRECTORY]) {
    folders.add(root)
    if (!empty)
      for (const [name, text] of Object.entries(sampleFiles)) {
        const path = `${root}/${name}`
        virtualFiles.set(path, new TextEncoder().encode(text))
        let parent = path.slice(0, path.lastIndexOf("/"))
        while (parent.startsWith(root)) {
          folders.add(parent)
          parent = parent.slice(0, parent.lastIndexOf("/"))
        }
      }
    if (!empty && binary) {
      folders.add(`${root}/samples`)
      for (const [name, bytes] of binaryAssets) virtualFiles.set(`${root}/${name}`, bytes.slice())
      virtualFiles.set(`${root}/samples/legacy.doc`, new Uint8Array([0, 1, 2]))
      virtualFiles.set(`${root}/samples/unsupported.bin`, new Uint8Array([0, 255, 0, 255]))
      virtualFiles.set(`${root}/samples/corrupt.pdf`, new TextEncoder().encode("Invalid PDF fixture"))
    }
  }
}
export function fileRequest(request: NativeRequest): unknown {
  const { operation, path } = request
  const failure =
    (operation === "writeFile" && mode === "saveError") ||
    (operation === "readFile" && mode === "readError") ||
    ((operation === "move" || operation === "copy") && mode === "moveError") ||
    (operation === "remove" && mode === "deleteError") ||
    (operation === "createDirectory" && mode === "createError")
  if (failure) {
    mode = "ready"
    throw new Error(`模拟文件操作失败: ${operation}`)
  }
  if (operation === "writeFile" && mode === "savePending") return new Promise(() => {})
  if (operation === "stat")
    return virtualFiles.has(path)
      ? { kind: "file", size: virtualFiles.get(path)!.length, version: String(version) }
      : folders.has(path)
        ? { kind: "directory", size: 0, version: String(version) }
        : null
  if (operation === "readDirectory") {
    const direct = (candidate: string) =>
      candidate.startsWith(`${path}/`) && !candidate.slice(path.length + 1).includes("/")
    return [...folders]
      .filter(direct)
      .map((path) => ({ path, name: path.slice(path.lastIndexOf("/") + 1), kind: "directory" }))
      .concat(
        [...virtualFiles.keys()]
          .filter(direct)
          .filter((file) => request.showHidden || !file.split("/").at(-1)!.startsWith("."))
          .map((path) => ({ path, name: path.slice(path.lastIndexOf("/") + 1), kind: "file" }))
      )
  }
  if (operation === "readFile") {
    const bytes = virtualFiles.get(path)
    if (!bytes) throw new Error(`File not found: ${path}`)
    return [...bytes]
  }
  if (operation === "writeFile") {
    virtualFiles.set(path, new Uint8Array(request.data ?? []))
    version++
    return
  }
  if (operation === "createDirectory") {
    folders.add(path)
    return
  }
  if (operation === "remove") {
    for (const candidate of [...virtualFiles.keys()])
      if (candidate === path || candidate.startsWith(`${path}/`)) virtualFiles.delete(candidate)
    folders.delete(path)
    return
  }
  if ((operation === "move" || operation === "copy") && request.to) {
    for (const [candidate, bytes] of [...virtualFiles])
      if (candidate === path || candidate.startsWith(`${path}/`)) {
        virtualFiles.set(request.to + candidate.slice(path.length), bytes.slice())
        if (operation === "move") virtualFiles.delete(candidate)
      }
    return
  }
  throw new Error(`Unsupported preview filesystem operation: ${operation}`)
}
