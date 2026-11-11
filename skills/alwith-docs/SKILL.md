---
name: alwith-docs
description: Explain ALwith U features, setup, settings, skills, plugins, model configuration and troubleshooting using versioned ALwith U documentation. Use for questions about using and configuring ALwith U.
metadata:
  short-description: ALwith U documentation, setup and troubleshooting
---

# ALwith Docs

Give practical, cited answers about using and configuring ALwith U, based on documentation for the installed application version.

## Find and read the source

For a specific question, use the `alwith_docs` server's `search` tool with a short topic query, then `fetch` the matching chapter before answering. Search accepts English and Chinese topic keywords. For a broad introduction, use `outline`, then fetch only the relevant chapters. These tools are read-only and work offline.

Use the returned `version` to scope claims and the exact returned `url` for Markdown citations. Those links open the matching chapter in U's user guide. Search excerpts are navigation aids, not sufficient evidence. If no chapter establishes a claim, say what is undocumented; do not invent settings, commands, limits or capabilities.

If the documentation server is unavailable, read [the bundled manual](references/manual.md). It includes its version and chapter links. Disclose that version when it differs from the running app. Do not inspect unrelated repositories or private planning documents to answer ordinary usage questions.

## Choose the relevant workflow

- Setup and self-knowledge: start with `start` and `interface`; distinguish ALwith login from model authentication.
- Skills, plugins and customization: read `plugins`; distinguish Codex skills/plugins from application extensions. The existing Skills page controls this skill's enabled state.
- Model selection or migration: read `models`. Preserve an explicitly requested model. Explain per-conversation selection and provider configuration. For current pricing, availability or model capabilities, search and open the relevant provider's official documentation and cite it separately. The bundled manual does not establish live model rankings or prices.
- Prompt improvement: read `chat`; adapt the user's concrete outcome, context and verification criteria without changing their chosen task or model.
- Troubleshooting: read `troubleshooting` and the affected feature chapter. Ask for the exact error and relevant versions when missing. Inspect local state only when diagnosis needs it and the user has authorized that work. Never expose credentials.

Current installed-version instructions take precedence for U controls. Clearly distinguish a verified local behavior, a documented behavior, and an unresolved claim. Requests for latest release behavior require a verified published ALwith U source; do not guess a documentation domain or present unreleased plans as available features.

Answer in the user's language. Explain the useful action first and cite the chapter supporting it. A request for help does not authorize changing configuration or sending messages.
