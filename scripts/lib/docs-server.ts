import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"

import { type GuideChapter, searchGuide } from "../../src/core/docs"

export function createDocsServer(chapters: GuideChapter[], version: string): Server {
  const server = new Server({ name: "alwith-docs", version }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "search",
        description: "Search the installed ALwith U user guide. Fetch a matching chapter before answering.",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string", minLength: 1, maxLength: 500 } },
          required: ["query"],
          additionalProperties: false
        },
        annotations: { readOnlyHint: true, openWorldHint: false }
      },
      {
        name: "fetch",
        description: "Read an ALwith U guide chapter with its installed version and clickable citation.",
        inputSchema: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
          additionalProperties: false
        },
        annotations: { readOnlyHint: true, openWorldHint: false }
      },
      {
        name: "outline",
        description: "List installed ALwith U guide chapters and topics for broad orientation.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, openWorldHint: false }
      }
    ]
  }))
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    try {
      const args = params.arguments ?? {}
      let data: unknown
      if (params.name === "search") {
        if (typeof args.query !== "string" || args.query.length > 500 || Object.keys(args).length !== 1)
          throw new Error("search requires one query of at most 500 characters")
        data = searchGuide(chapters, args.query)
      } else if (params.name === "fetch") {
        if (typeof args.id !== "string" || Object.keys(args).length !== 1)
          throw new Error("fetch requires a chapter ID")
        const chapter = chapters.find((entry) => entry.id === args.id)
        if (!chapter) throw new Error(`Unknown guide chapter: ${args.id}`)
        data = { id: chapter.id, title: chapter.title, url: chapter.url, text: chapter.text }
      } else if (params.name === "outline") {
        if (Object.keys(args).length) throw new Error("outline accepts no arguments")
        data = chapters.map(({ id, title, summary, url }) => ({ id, title, summary, url }))
      } else throw new Error(`Unknown documentation tool: ${params.name}`)
      return { content: [{ type: "text", text: JSON.stringify({ product: "ALwith U", version, data }) }] }
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }]
      }
    }
  })
  return server
}
