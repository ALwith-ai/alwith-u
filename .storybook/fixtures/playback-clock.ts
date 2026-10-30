// Isolate playback timing in the preview iframe. The player's own timer stays native.
const nativeTimeout = window.setTimeout.bind(window)
const nativeClearTimeout = window.clearTimeout.bind(window)
const nativeInterval = window.setInterval.bind(window)
const nativeClearInterval = window.clearInterval.bind(window)
const nativeFocus = HTMLElement.prototype.focus
export const playbackDelay = (ms: number) => new Promise<void>((resolve) => nativeTimeout(resolve, ms))
interface Task {
  callback: () => void
  delay: number
  remaining: number
  due: number
  repeat: boolean
  handle?: number
}
let sequence = 1_000_000
let installed = false
let paused = false
const tasks = new Map<number, Task>()
const videos = new Set<HTMLVideoElement>()
function arm(id: number, task: Task) {
  task.due = performance.now() + task.remaining
  task.handle = nativeTimeout(() => {
    if (!task.repeat) tasks.delete(id)
    else task.remaining = task.delay
    task.callback()
    if (task.repeat && tasks.has(id) && !paused) arm(id, task)
  }, task.remaining)
}
function schedule(callback: TimerHandler, delay = 0, repeat = false, args: unknown[] = []) {
  if (typeof callback !== "function") throw new Error("Playback requires function timers")
  const id = ++sequence
  const task: Task = { callback: () => callback(...args), delay, remaining: delay, due: 0, repeat }
  tasks.set(id, task)
  if (!paused) arm(id, task)
  return id
}
function cancel(id?: number) {
  const task = id === undefined ? undefined : tasks.get(id)
  if (task) {
    nativeClearTimeout(task.handle)
    tasks.delete(id!)
  } else nativeClearTimeout(id)
}
export function installPlaybackClock() {
  disposePlaybackClock()
  installed = true
  // Replaying a later checkpoint must not scroll the outer diagram to its iframe.
  HTMLElement.prototype.focus = function (options) {
    nativeFocus.call(this, { ...options, preventScroll: true })
  }
  window.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) =>
    schedule(callback, delay, false, args)) as typeof window.setTimeout
  window.setInterval = ((callback: TimerHandler, delay?: number, ...args: unknown[]) =>
    schedule(callback, delay, true, args)) as typeof window.setInterval
  window.clearTimeout = cancel as typeof window.clearTimeout
  window.clearInterval = cancel as typeof window.clearInterval
}
export function pausePlaybackClock(value: boolean) {
  if (!installed || value === paused) return
  paused = value
  document.documentElement.toggleAttribute("data-workflow-paused", value)
  if (value) {
    for (const task of tasks.values()) {
      nativeClearTimeout(task.handle)
      task.remaining = Math.max(0, task.due - performance.now())
    }
    for (const video of document.querySelectorAll("video")) {
      if (!video.paused) {
        videos.add(video)
        video.pause()
      }
    }
  } else {
    for (const [id, task] of tasks) arm(id, task)
    for (const video of videos) void video.play().catch(() => {})
    videos.clear()
  }
}
export function disposePlaybackClock() {
  if (!installed) return
  pausePlaybackClock(false)
  for (const task of tasks.values()) nativeClearTimeout(task.handle)
  tasks.clear()
  window.setTimeout = nativeTimeout as typeof window.setTimeout
  window.clearTimeout = nativeClearTimeout
  window.setInterval = nativeInterval as typeof window.setInterval
  window.clearInterval = nativeClearInterval
  HTMLElement.prototype.focus = nativeFocus
  installed = false
}
