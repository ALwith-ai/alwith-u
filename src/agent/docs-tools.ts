import { defineApplicationTool } from "@alwith/module-chat/client"

import { type GuideChapter, searchGuide } from "../core/docs"

type DocsService = { chapters: GuideChapter[]; version: string }

/** Read-only application tools share the guide's parsed content and citation URLs. */
export const docsToolSet = {
  version: 1,
  revision: "docs-v1",
  definitions: [
    {
      name: "alwith_docs_search",
      description: "Search the installed ALwith U user guide. Fetch a matching chapter before answering.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string", minLength: 1, maxLength: 500 } },
        required: ["query"],
        additionalProperties: false
      }
    },
    {
      name: "alwith_docs_fetch",
      description: "Read an ALwith U guide chapter with its installed version and clickable citation.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false
      }
    },
    {
      name: "alwith_docs_outline",
      description: "List installed ALwith U guide chapters and topics for broad orientation.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false }
    }
  ]
}

function callDocsTool(service: DocsService, name: string, input: unknown) {
  if (input === undefined) input = {}
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new Error("Expected documentation arguments")
  const args = input as Record<string, unknown>
  let data: unknown
  if (name === "alwith_docs_search") {
    if (typeof args.query !== "string" || args.query.length > 500 || Object.keys(args).length !== 1)
      throw new Error("search requires one query of at most 500 characters")
    data = searchGuide(service.chapters, args.query)
  } else if (name === "alwith_docs_fetch") {
    if (typeof args.id !== "string" || Object.keys(args).length !== 1) throw new Error("fetch requires a chapter ID")
    const chapter = service.chapters.find((entry) => entry.id === args.id)
    if (!chapter) throw new Error(`Unknown guide chapter: ${args.id}`)
    data = { id: chapter.id, title: chapter.title, url: chapter.url, text: chapter.text }
  } else if (name === "alwith_docs_outline") {
    if (Object.keys(args).length) throw new Error("outline accepts no arguments")
    data = service.chapters.map(({ id, title, summary, url }) => ({ id, title, summary, url }))
  } else throw new Error(`Unknown documentation tool: ${name}`)
  return { product: "ALwith U", version: service.version, data }
}

export function createDocsTools(service: DocsService) {
  return docsToolSet.definitions.map((definition) =>
    defineApplicationTool({
      ...definition,
      revision: docsToolSet.revision,
      autoApprove: () => true,
      parse: (input: unknown) => callDocsTool(service, definition.name, input),
      execute: (result) => ({ success: true, contentItems: [{ type: "text", text: JSON.stringify(result) }] })
    })
  )
}
