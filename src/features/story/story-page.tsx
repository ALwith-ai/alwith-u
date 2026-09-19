// Story demo: one story root, its frame, a dsh agent bound to it, and the ledger and notes the module
// keeps while the agent runs. Everything shown comes from the module; the page holds no story state.
import { appDataDir, join } from "@tauri-apps/api/path"
import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Pane } from "@/components/alwith-ui/pane"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  type Frame,
  type LedgerEntry,
  type Note,
  onStoryChanged,
  parseFrame,
  renderFrame,
  startStoryAgent,
  type StoryAgent,
  type StorySnapshot,
  storyAvailable,
  storyCall,
  transcriptLine
} from "./story-client"

type Line = { kind: "input" | "prose" | "tool" | "notice"; text: string }

export function StoryPage() {
  const { t } = useTranslation()
  const [available, setAvailable] = useState<boolean | null>(null)
  const [root, setRoot] = useState("")
  const [snapshot, setSnapshot] = useState<StorySnapshot | null>(null)
  const [frameText, setFrameText] = useState("")
  const [ledger, setLedger] = useState<LedgerEntry[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [lines, setLines] = useState<Line[]>([])
  const [prompt, setPrompt] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const agentRef = useRef<StoryAgent | null>(null)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const ok = await storyAvailable().catch(() => false)
      if (cancelled) return
      setAvailable(ok)
      const fallback = await join(await appDataDir(), "stories", "demo")
      if (!cancelled) setRoot(previous => (previous === "" ? fallback : previous))
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const fail = useCallback((source: unknown) => setError(source instanceof Error ? source.message : String(source)), [])

  const refresh = useCallback(async (target: string) => {
    const [state, entries, list] = await Promise.all([
      storyCall<StorySnapshot>("state", { root: target }),
      storyCall<LedgerEntry[]>("ledger/read", { root: target }),
      storyCall<Note[]>("note/list", { root: target })
    ])
    setSnapshot(state)
    setLedger(entries)
    setNotes(list)
    return state
  }, [])

  const open = useCallback(async () => {
    setError(null)
    try {
      const state = await storyCall<StorySnapshot>("open", { root })
      setFrameText(renderFrame(state.frame))
      await refresh(root)
    } catch (source) {
      fail(source)
    }
  }, [root, refresh, fail])

  useEffect(() => {
    if (snapshot === null) return
    let stop: (() => void) | null = null
    void onStoryChanged(event => {
      if (event.root === snapshot.root) void refresh(snapshot.root).catch(fail)
    }).then(unlisten => {
      stop = unlisten
    })
    return () => stop?.()
  }, [snapshot?.root, refresh, fail, snapshot])

  const saveFrame = useCallback(async () => {
    if (snapshot === null) return
    setError(null)
    try {
      const frame = await storyCall<Frame>("frame/set", {
        root: snapshot.root,
        sections: parseFrame(frameText),
        expectedRevision: snapshot.revision
      })
      setFrameText(renderFrame(frame))
      await refresh(snapshot.root)
    } catch (source) {
      fail(source)
    }
  }, [snapshot, frameText, refresh, fail])

  const start = useCallback(async () => {
    if (snapshot === null || agentRef.current !== null) return
    setError(null)
    setBusy(true)
    try {
      const started = await startStoryAgent(snapshot.root)
      agentRef.current = started
      started.agent.onNotification((method, params) => {
        if (method !== "session/update") return
        const { sessionId, update } = params as { sessionId: string; update: Parameters<typeof transcriptLine>[0] }
        if (sessionId !== started.sessionId) return
        const line = transcriptLine(update)
        if (line === null) return
        setLines(previous => {
          const last = previous.at(-1)
          if (line.kind === "prose" && last?.kind === "prose")
            return [...previous.slice(0, -1), { kind: "prose", text: last.text + line.text }]
          return [...previous, line]
        })
      })
      started.agent.onAgentRequest(request => {
        if (request.method !== "session/request_permission") return
        const { options } = request.params as { options: Array<{ optionId: string; kind: string }> }
        const reject = options.find(option => option.kind === "reject_once") ?? options[0]
        void started.agent.respond(request.id, { outcome: { outcome: "selected", optionId: reject?.optionId } })
        setLines(previous => [...previous, { kind: "notice", text: t("story.rejected") }])
      })
      started.agent.onGone(() => {
        agentRef.current = null
        setRunning(false)
      })
      setRunning(true)
    } catch (source) {
      fail(source)
    } finally {
      setBusy(false)
    }
  }, [snapshot, fail, t])

  const stop = useCallback(async () => {
    const started = agentRef.current
    if (started === null) return
    try {
      await started.agent.stop()
    } catch (source) {
      fail(source)
    }
  }, [fail])

  const send = useCallback(async () => {
    const started = agentRef.current
    const text = prompt.trim()
    if (started === null || text.length === 0) return
    setPrompt("")
    setLines(previous => [...previous, { kind: "input", text }])
    setBusy(true)
    try {
      await started.agent.request("session/prompt", { sessionId: started.sessionId, prompt: [{ type: "text", text }] })
    } catch (source) {
      fail(source)
    } finally {
      setBusy(false)
    }
  }, [prompt, fail])

  if (available === false) {
    return <div className="text-muted-foreground mx-auto max-w-xl p-10 text-sm">{t("story.unavailable")}</div>
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <h1 className="text-base font-semibold">{t("story.title")}</h1>
        <Input
          className="max-w-xl font-mono text-xs"
          value={root}
          onChange={event => setRoot(event.target.value)}
          placeholder={t("story.root")}
        />
        <Button size="sm" onClick={() => void open()} disabled={root.length === 0}>
          {t("story.open")}
        </Button>
        {snapshot !== null && (
          <span className="text-muted-foreground text-xs">
            {t("story.status", { revision: snapshot.revision, entries: snapshot.ledgerLength, notes: snapshot.notes })}
          </span>
        )}
      </div>
      {error !== null && <div className="text-destructive font-mono text-xs">{error}</div>}
      {snapshot !== null && (
        <div className="grid min-h-0 flex-1 grid-cols-3 gap-3">
          <section className="flex min-h-0 flex-col gap-2">
            <header className="flex items-center justify-between">
              <span className="text-sm font-medium">{t("story.frame")}</span>
              <Button size="sm" variant="outline" onClick={() => void saveFrame()}>
                {t("story.saveFrame")}
              </Button>
            </header>
            <p className="text-muted-foreground text-xs">{t("story.frameHint")}</p>
            <Textarea
              className="min-h-0 flex-1 font-mono text-xs"
              value={frameText}
              onChange={event => setFrameText(event.target.value)}
            />
          </section>
          <section className="flex min-h-0 flex-col gap-2">
            <header className="flex items-center justify-between">
              <span className="text-sm font-medium">{t("story.transcript")}</span>
              {running ? (
                <Button size="sm" variant="outline" onClick={() => void stop()}>
                  {t("story.stop")}
                </Button>
              ) : (
                <Button size="sm" onClick={() => void start()} disabled={busy}>
                  {t("story.start")}
                </Button>
              )}
            </header>
            <Pane className="min-h-0 flex-1 rounded-md border">
              <div className="flex flex-col gap-2 p-3 text-sm">
                {lines.map((line, index) => (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: append-only transcript
                    key={index}
                    className={
                      line.kind === "input"
                        ? "bg-muted rounded-md px-2 py-1"
                        : line.kind === "prose"
                          ? "whitespace-pre-wrap"
                          : "text-muted-foreground font-mono text-xs"
                    }>
                    {line.text}
                  </div>
                ))}
              </div>
            </Pane>
            <Textarea
              className="h-20 resize-none"
              value={prompt}
              onChange={event => setPrompt(event.target.value)}
              placeholder={t("story.promptHint")}
              disabled={!running}
              onKeyDown={event => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault()
                  void send()
                }
              }}
            />
          </section>
          <section className="flex min-h-0 flex-col gap-2">
            <span className="text-sm font-medium">{t("story.notes")}</span>
            <Pane className="max-h-[40%] min-h-24 rounded-md border">
              <div className="flex flex-col gap-2 p-3 text-xs">
                {notes.length === 0 && <span className="text-muted-foreground">{t("story.noNotes")}</span>}
                {notes.map((note, index) => {
                  const current =
                    note.invalidatedAt === undefined &&
                    notes.slice(index + 1).every(later => later.invalidatedAt !== undefined)
                  return (
                    <div key={note.id} className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <Badge variant={current ? "default" : "outline"}>
                          {note.invalidatedAt === undefined
                            ? current
                              ? t("story.current")
                              : `#${note.generation}`
                            : t("story.invalidated")}
                        </Badge>
                        <span className="text-muted-foreground">
                          {t("story.through", { seq: note.throughSeq, sources: note.sourceSeqs.join(",") })}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap">{note.text}</p>
                    </div>
                  )
                })}
              </div>
            </Pane>
            <span className="text-sm font-medium">{t("story.ledger")}</span>
            <Pane className="min-h-0 flex-1 rounded-md border">
              <div className="flex flex-col gap-2 p-3 text-xs">
                {ledger.map(entry => (
                  <div key={entry.seq} className="flex gap-2">
                    <span className="text-muted-foreground shrink-0 font-mono">
                      #{entry.seq} {entry.kind}
                    </span>
                    <span className="whitespace-pre-wrap">{entry.text}</span>
                  </div>
                ))}
              </div>
            </Pane>
          </section>
        </div>
      )}
    </div>
  )
}
