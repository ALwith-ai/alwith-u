import { createStreamingMarkdownLexer } from "@alwith/chat/streaming-markdown"
import type { MarkdownParseResponse, MarkdownWorkerRequest } from "@alwith/chat/markdown-parser"
import type { CodeHighlightRequest, CodeHighlightResponse } from "@alwith/chat/code-highlighter"
import highlighter from "highlight.js"

/** In-process worker transport: real parsing/highlighting, no native worker or child process. */
export class ChatWorkerStub {
  onmessage: ((event: MessageEvent<MarkdownParseResponse | CodeHighlightResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: (() => void) | null = null
  private readonly kind: "markdown" | "code"
  private readonly lexers = new Map<number, ReturnType<typeof createStreamingMarkdownLexer>>()

  constructor(url: URL) {
    if (url.pathname.includes("markdown-parser.worker")) this.kind = "markdown"
    else if (url.pathname.includes("code-highlighter.worker")) this.kind = "code"
    else throw new Error(`Unexpected worker URL: ${url.href}`)
  }

  postMessage(message: MarkdownWorkerRequest | CodeHighlightRequest): void {
    if (this.kind === "markdown") {
      const request = message as MarkdownWorkerRequest
      if (request.type === "dispose") {
        this.lexers.delete(request.clientId)
        return
      }
      let lexer = this.lexers.get(request.clientId)
      if (lexer === undefined) {
        lexer = createStreamingMarkdownLexer()
        this.lexers.set(request.clientId, lexer)
      }
      this.respond({ clientId: request.clientId, revision: request.revision, ok: true, tokens: lexer.parse(request.source) })
    } else {
      const request = message as CodeHighlightRequest
      const language = request.language?.toLowerCase()
      const html = language === undefined || language.length === 0
        ? highlighter.highlightAuto(request.code).value
        : highlighter.getLanguage(language) === undefined ? null : highlighter.highlight(request.code, { language }).value
      this.respond({ clientId: request.clientId, revision: request.revision, ok: true, html })
    }
  }

  terminate(): void {
    this.lexers.clear()
  }

  private respond(response: MarkdownParseResponse | CodeHighlightResponse): void {
    if (this.onmessage === null) throw new Error("Worker message handler is missing")
    this.onmessage(new MessageEvent("message", { data: response }))
  }
}
