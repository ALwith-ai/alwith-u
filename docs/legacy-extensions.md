# Compatibility with Desktop business extensions

## Scope

U uses the optional `legacy` entry of the public package `@alwith/module-extension` 0.1.3 to adapt the following business code snapshots:

| Extension | Installed version when reviewed | Source SHA-256 prefix |
| --- | --- | --- |
| bi-metrics | 2.36.2 | 150bded59b67 |
| yup-kb | 2.20.0 | 53536c9c1af6 |
| etms-strategy-review | 0.1.0 | b5b12392592e |

The full digests and exact patches are in `src/features/extensions/legacy/profiles.json`. Compatibility is keyed to the business code digest; an old manifest version number cannot guarantee that the remote code is unchanged. Code that differs from the reviewed snapshot is refused on import and needs a new compatibility review.

`alwith-desktop` and `@nyssance/codex-acp-v2` were not modified, Codex's internal session files are not read, and no session store was added.

**This is not a claim that every business feature of the three extensions has passed real integration.** Page, SDK, network and file adaptation are implemented; YUP session archiving is explicitly deferred, and the AI features also depend on business skills adapted for U.

## Import and update

1. Open U's extension manager and click "Install from local folder". New and old extensions share this entry.
2. Choose the old extension's folder, for example `~/.alwith/extensions/bi-metrics`.
3. The host reads the manifest and routes it: a folder declaring `manifestVersion` or `dependencies` is validated as the new format; a folder with neither and a non-empty `minAppVersion` is a legacy candidate. A failed new-format validation is an error, never a downgrade. Legacy folders are then recognised as a complete business package or a known remote loader; for a loader, the business code is fetched only from a fixed HTTPS address and checked against its digest, and the original loader never runs.
4. The native side validates the converted result, stages the standard package and authorises the install. A first install is enabled automatically; an update keeps the existing enabled state.
5. Toolbar buttons default to the left and keep the chart, document, book and shield icons the extensions declare; clicking one opens the business workspace, and the extension's internal pages map to workspace tabs. Settings pages appear in U's settings sections and can also be opened by the extension directly.

"Update from folder" goes through the same folder selection and format recognition and checks the extension ID before converting or downloading. An unavailable network, a digest mismatch or a conflicting incompatible extension of the same name is reported explicitly and never replaced silently.

The installed package contains only `manifest.json`, `main.js` and `styles.css`. The source is embedded as data in the standard entry, so Browserify's internal modules are not mistaken for host dependencies.

## Public package and host responsibilities

| Layer | Responsibility |
| --- | --- |
| Public package `./legacy` | Plugin/Component, ItemView/WorkspaceLeaf, settings controls, Modal/Notice, DOM helpers, legacy requestUrl semantics, resource cleanup |
| U's importer | Pinned business snapshots, legacy manifest conversion, reviewed source patches, initial configuration migration |
| U's native bridge | Business HTTPS requests, binary and multipart bodies, private file space, folder grants, install source and package digest checks |
| U's page and chat adaptation | Page navigation, explicit session IDs, calls into the existing Runtime/ACP client, Codex skill dependency checks |

One public runtime handles install, enable, disable and update; no separate legacy extension runtime was built. The compatibility facade maps APIs and lifecycles; it is not a security sandbox for untrusted JavaScript, so install only extensions you trust.

## Configuration and files

- Configuration in `data.json` is migrated into the public package's data store on its own. The original folder is never written. Configuration is persisted first, then the transit copy is cleared once confirmed; concurrent first migrations are handled by the existing data revision check.
- YUP's `workspaces.json` is copied into U's private file space without overwriting files U already has, and paths recorded in it are not granted automatically.
- Old home paths are virtual inside the compatibility layer; the real files live in `legacy-extension-files/<id>/` under U's app data directory. Nothing is written back to Desktop's `~/.alwith`.
- Folders the user chooses are recorded in `legacy-directory-grants.json` under U's app data directory. Later reads and writes need a valid grant for the same extension; path escapes and symlink escapes are refused.
- Compatibility package certificates are stored per extension ID and package revision in `legacy-imports.json`. Staging a new version does not invalidate the version in use.
- ETMS export requires choosing the working directory of the bound session, and export file names in prompts are turned into absolute paths. File names are limited to that extension's analysis bundle.

HTTP requests are allowed only to business service domains reviewed in code. Explicit Bearer headers and multipart data are kept, host cookies are not inherited, and cross-origin redirects are not followed automatically. Requests and responses are capped at 64 MiB.

## Chat and skill boundary

The first time a business button is used, it captures the ID of an open usable session. Asynchronous requests still go to that ID when they finish; the destination is never inferred from whichever chat is selected by then. This implementation conservatively fixes the target for one extension activation; changing it means disabling and re-enabling the extension and acting again in the new session. A notice is shown when the target is captured.

Before an AI request is sent, Codex's `skills_list` is used to check that the business skills the prompt references are enabled. Currently these are `bi-add-metric`, `bi-monthly-report`, `yup-kb` and `etms-strategy-review`. When one is missing or disabled, the analysis request is not sent and a notice says to install the U-adapted version through the existing plugin and skill catalog.

**A skill presence check is not a certification of business compatibility.** Desktop's original skills hard-code reads of `~/.alwith/extensions/*/data.json`, and YUP also uses `current.json` and `tree-dirty.flag` in the old location. Copying, renaming or pasting the original SKILL text into prompts is not enough to adapt them. The companion Codex skills still need to define U's credentials, file context and business request contract; this work did not install or rewrite any Codex skill folder.

## Explicitly deferred features

YUP's automatic session archiving, manual archiving and workspace-linked session upload are disabled with an explanation. Local workspace file sync is kept. No fake empty history is returned, and `session/resume` is not passed off as a read-only history export.

BI's original automatic download and write of Desktop skills is disabled; skills are managed by Codex's plugin and skill system. The native host offers only the capabilities that are implemented, and unknown legacy commands are reported as errors.

## Verification boundary

Automated checks cover the public SDK lifecycle, settings page mounting, configuration migration and subscriptions, binary and multipart bodies, paths and grants, standard package installation and source certificates, explicit session routing and skill dependency decisions.

The three real business code snapshots were additionally run under a controlled DOM and fake HTTP, signed out and signed in: loading, settings pages, workspace mounting and unloading. That run did not call the real login service.

Real account integration is still required before delivery: login, real reports and charts, iframe interaction, knowledge base upload and download, ETMS review, and the AI loop with the companion U skills. Passing automation cannot replace this business acceptance.
