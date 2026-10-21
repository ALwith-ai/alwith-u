/** Reproducible vector artwork for the bundled ALwith U agent cursor. */
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
const root = join(import.meta.dir, "../src-tauri/assets/computer")
await mkdir(root, { recursive: true })
const source = await mkdtemp(join(tmpdir(), "alwith-cursor-"))
await mkdir(join(source, "a"), { recursive: true })
await mkdir(join(source, "cua"), { recursive: true })
const actions = [
  "idle",
  "observe",
  "click",
  "drag",
  "scroll",
  "text",
  "key",
  "navigate",
  "app",
  "transfer",
  "record",
  "system"
]
const value = (k: unknown) => ({ a: 0, k })
const path = (points: number[][], closed = true) => ({
  ty: "sh",
  ks: value({ v: points, i: points.map(() => [0, 0]), o: points.map(() => [0, 0]), c: closed })
})
const paint = (color: number[]) => ({ ty: "fl", c: value(color), o: value(100), r: 1 })
const stroke = (color: number[], width: number) => ({
  ty: "st",
  c: value(color),
  o: value(100),
  w: value(width),
  lc: 2,
  lj: 2,
  ml: 4
})
const white = [1, 1, 1, 1],
  blue = [0.31, 0.36, 1, 1]
const outline = [
  [24, 16],
  [37, 94],
  [54, 76],
  [68, 104],
  [81, 98],
  [67, 70],
  [94, 65]
]
function layer(ind: number, shapes: unknown[], opacity = value(100)) {
  return {
    ddd: 0,
    ind,
    ty: 4,
    nm: `U ${ind}`,
    sr: 1,
    ks: { o: opacity, r: value(0), p: value([0, 0]), a: value([0, 0]), s: value([100, 100]) },
    ao: 0,
    shapes,
    ip: 0,
    op: 30,
    st: 0,
    bm: 0
  }
}
const files: string[] = []
async function save(name: string, data: unknown) {
  const file = join(source, name)
  await writeFile(file, JSON.stringify(data))
  await utimes(file, new Date("2020-01-01"), new Date("2020-01-01"))
  files.push(name)
}
for (const action of actions) {
  await save(`a/${action}.json`, {
    v: "5.7.4",
    fr: 30,
    ip: 0,
    op: 30,
    w: 128,
    h: 128,
    nm: `ALwith U ${action}`,
    ddd: 0,
    assets: [],
    layers: [layer(1, [path(outline), paint(blue), stroke(white, 3)])]
  })
}
await save("manifest.json", { version: "2", animations: actions.map((id) => ({ id })) })
await save("cua/theme.json", {
  schema: "cua.cursor-theme/2",
  id: "ai.alwith.u",
  name: "ALwith U",
  version: "1.0.0",
  author: "ALwith",
  license: "Apache-2.0",
  compatibility: { profile: "cua-driver-actions-v2", semantics: 2 },
  canvas: { width: 128, height: 128, fps: 30 },
  hotspot: { x: 24, y: 16 },
  actions: Object.fromEntries(actions.map((id) => [id, { animation: id, still_frame: 15 }]))
})
const archive = join(root, "alwith-u.lottie")
await Bun.file(archive)
  .delete()
  .catch(() => {})
const zip = Bun.spawn(["zip", "-q", "-X", archive, ...files.toSorted()], {
  cwd: source,
  stdout: "inherit",
  stderr: "inherit"
})
if (await zip.exited) throw new Error("Cursor source archive failed")
await rm(source, { recursive: true })
console.log(archive)
