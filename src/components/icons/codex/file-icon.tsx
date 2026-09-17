// Codex desktop's file-type icons (16×16, currentColor, one colour per theme), taken from
// the Codex icon set the user exported; a stand-in until the app ships its own set.
import { useTheme } from "@/components/theme-provider"
import { basename } from "@/lib/path"
import icons from "./file-icons.json"

type FileIconName = keyof typeof icons

const BY_BASENAME: Record<string, FileIconName> = {
  "package.json": "npm",
  "package-lock.json": "npm",
  "bun.lock": "bun",
  "bun.lockb": "bun",
  "bunfig.toml": "bun",
  dockerfile: "docker",
  ".dockerignore": "docker",
  ".gitignore": "git",
  ".gitattributes": "git",
  ".gitmodules": "git",
  "claude.md": "claude",
  ".mcp.json": "mcp",
  "biome.json": "biome",
  "biome.jsonc": "biome",
  ".browserslistrc": "browserslist",
  ".oxlintrc.json": "oxc",
  ".prettierrc": "prettier",
  ".prettierignore": "prettier",
  ".stylelintrc": "stylelint",
  "cargo.lock": "lock",
  "yarn.lock": "lock",
  "pnpm-lock.yaml": "lock"
}

const BY_PREFIX: Array<[string, FileIconName]> = [
  ["tailwind.config", "tailwind"],
  ["vite.config", "vite"],
  ["vitest.config", "vite"],
  ["next.config", "nextjs"],
  ["webpack.config", "webpack"],
  ["postcss.config", "postcss"],
  ["svgo.config", "svgo"],
  ["eslint.config", "eslint"],
  [".eslintrc", "eslint"],
  ["prettier.config", "prettier"],
  [".prettierrc", "prettier"],
  ["stylelint.config", "stylelint"],
  ["babel.config", "babel"],
  [".babelrc", "babel"]
]

const BY_EXTENSION: Record<string, FileIconName> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "json",
  md: "markdown",
  mdx: "markdown",
  css: "css",
  scss: "sass",
  sass: "sass",
  html: "html",
  htm: "html",
  svg: "svg",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  ico: "image",
  rs: "rust",
  py: "python",
  go: "go",
  rb: "ruby",
  swift: "swift",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  hpp: "cpp",
  zig: "zig",
  vue: "vue",
  svelte: "svelte",
  astro: "astro",
  yml: "yml",
  yaml: "yml",
  sql: "database",
  wasm: "wasm",
  zip: "zip",
  gz: "zip",
  tgz: "zip",
  tar: "zip",
  ttf: "font",
  otf: "font",
  woff: "font",
  woff2: "font",
  tf: "terraform",
  graphql: "graphql",
  gql: "graphql",
  sh: "bash",
  zsh: "bash",
  bash: "bash",
  txt: "text",
  toml: "text",
  lock: "lock",
  csv: "table",
  tsv: "table"
}

export function fileIconName(path: string): FileIconName {
  const name = basename(path).toLowerCase()
  const exact = BY_BASENAME[name]
  if (exact) return exact
  for (const [prefix, icon] of BY_PREFIX) if (name.startsWith(prefix)) return icon
  const dot = name.lastIndexOf(".")
  const extension = dot > 0 ? name.slice(dot + 1) : ""
  return BY_EXTENSION[extension] ?? "file"
}

export function CodexFileIcon({ path, className }: { path: string; className?: string }) {
  const { resolvedTheme } = useTheme()
  const icon = icons[fileIconName(path)]
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="currentColor"
      aria-hidden="true"
      className={className}
      style={{ color: resolvedTheme === "dark" ? icon.dark : icon.light }}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: 渲染内置图标集的可信本地 SVG,不是用户内容
      dangerouslySetInnerHTML={{ __html: icon.body }}
    />
  )
}
