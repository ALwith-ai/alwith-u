export const tools: {
  name: string
  description: string
  inputSchema: { type: string; properties: Record<string, unknown>; required: string[]; additionalProperties: boolean }
}[]
