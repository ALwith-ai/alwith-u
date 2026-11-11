import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"

import metadata from "../guide/catalog.json"
// Bun bundles the same Markdown that Vite imports in the guide window.
import content from "../guide/index.md" with { type: "text" }
import manifest from "../package.json"
import { parseGuide } from "../src/core/docs"
import { createDocsServer } from "./lib/docs-server"

await createDocsServer(parseGuide(content, metadata), manifest.version).connect(new StdioServerTransport())
