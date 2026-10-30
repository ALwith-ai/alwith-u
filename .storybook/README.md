# Source page and workflow catalog

Run `bun run storybook` and open <http://127.0.0.1:6007>. The sidebar has exactly two roots:

- **页面**: reachable pages and their feature groups. Each **状态总览** contains only peer states of one control.
- **流程**: module → individual journey → **完整流程图**. Each diagram contains the source pages for its checkpoints, connected in order.

Use Controls to change the page, conversation state, response behavior, project data, selected file, connection, account, plugin/extension state, cloud state, settings section, pet state, window width, operating-system shell, wallpaper, zoom, global elicitation, composer behavior, binary file preview, or operation failures. Switching stories or changing Controls resets the in-memory preview state. Theme and language remain available in the Storybook toolbar.

## Page and feature stories

The sidebar groups page states by page and feature. Each leaf story opens its own complete, live source page. Source case files under `stories/pages/` provide the page component, args, loaders and interactions; generated modules under `stories/page-boards/` expose each case as an individual sidebar entry.

After adding, renaming, or reordering a page case, run `bun .storybook/generate-page-boards.mjs` to refresh the feature groups and individual stories.

## Individual workflows

There are **144 individual journeys** with **492 embedded intermediate/final checkpoints**. A workflow folder contains only the pages and actions belonging to that journey.

- Open **完整流程图** for a single horizontal canvas with 1100px-wide pages, action labels above the arrows, and separate numbered step names above each page image. Drag either blank canvas or a page image to pan. Pages have no click action; the toolbar only offers zoom out, the current scale, and zoom in. Browser layout zoom preserves text rendering.
- Every step renders in an isolated iframe and replays source interactions to its checkpoint. Preparation runs in order because sibling frames share keyboard focus; completed pages remain visible while later steps load. These are live source components, not screenshots.
- Embedded checkpoints are reached with the `workflowStep` query parameter on the journey story; they are no longer separate sidebar stories.

Sidebar workflow titles use concise purpose names from `workflow-names.json`; individual actions and checkpoint labels remain inside the diagram. Definitions live in `stories/flow-definitions/`. After editing a definition, run `bun .storybook/generate-workflows.mjs` and `bun fmt .storybook` with the repository Bun version. The generator emits static CSF exports under `stories/flows/<module>/`, so each journey appears in Storybook search, navigation, and the test catalog. The generator excludes definitions without actual interactions; their state previews remain under **页面**. It removes only obsolete files carrying its generated-file header.

## Source ownership

The catalog imports current components from `src/`, the shared packages pinned by `bun.lock`, and `src/index.css`. `product-preview.tsx` composes the same source layout, navigation, chat, and workspace components as `src/app.tsx`. Auxiliary previews mount `SettingsPage`, `ChatWindow`, `GamepadWindow`, `GuidePage`, `AuthGate`, `PetWindow`, and `PetQuickReply` directly. This covers all seven Vite window entrypoints, including the desktop pet and its reply bubble.

The app bootstrap is replaced because it starts native services. Only host boundaries are substituted in `.storybook/main.ts`: the client/runtime, native IPC, authentication, cloud transport, extension runtime, window handoff, native HTML URL transport, and native wallpaper resource URL transport. No business component or shared UI primitive is replaced. No production source or design tokens are modified.

## Product reachability (2026-10-26)

Only pages with a current product entrypoint, states reachable through those pages, and details of components used by those surfaces belong in this catalog. Importing a component from product source does not establish that users can reach it. Simulated account, network, file, and extension data supplies external conditions for existing UI; it does not add product navigation.

The directory review checked main navigation in `src/app.tsx`, all seven Vite window entrypoints, settings navigation, chat actions, account/help menus, and the source components used by the detail examples. The following retained source implementations are excluded:

| Excluded surface | Source evidence | Storybook cleanup |
| --- | --- | --- |
| Story demo | `src/features/story/story-page.tsx` identifies it as a demo. `src/app.tsx` retains a `view === "story"` render branch but no action sets that view. | Removed five page examples, three journeys and their 13 checkpoints, the direct preview selector, reset data and host substitution. |
| MCP startup diagnostics menu | `src/features/chat/chat-actions-menu.tsx` sets `showMcpDiagnostics = false`. | Removed two isolated examples, their custom menu wrapper and diagnostic-only Controls/data. Plugin MCP server details remain part of the reachable plugin detail page. |

Guide, gamepad, floating chat, and desktop pet windows retain real product paths: help menu, account/recommendation entries, chat window handoff, and pet controls respectively. Component and layout detail examples remain for rendering and geometry checks; they do not establish additional product modules. Product source is preserved.

## Coverage map

| Source surface | 页面 examples | 流程 examples |
| --- | --- | --- |
| `DraftChat`, `ChatView`, composer and turn components | Quick/project chats; first use; connecting/disconnected/failure; generation, reasoning, tools, plans; tables/code/images; long/history/read-only/restoring/stopped/error states | Send and continue; stop; reconnect; model selection; project selection; rename; find; floating-window handoff |
| `SessionActions`, `ActionCard`, elicitation and async questions | Permission options, forms, URL authorization, choice/free-text questions | Allow once/always/reject; accept/decline/cancel forms; open/decline/cancel authorization; answer questions |
| `ThreadSidebar`, `CommandPalette`, `LeadingNavigation`, archive page | Projects, activity, cloud, account menus, search/empty search, shortcuts; archive empty/loading/large lists and delete confirmation | Feature navigation; search; settings entry; restore; filter; delete one/all; cancel deletion |
| `FileWorkspace`, shared editor and file tree | Markdown, TSX, JSON, CSV, SVG, HTML, PDF, DOCX, XLSX, TIFF, audio, video, text, corrupt/unsupported/missing files; multi-pane layout and resizing | Preview/source; edit/save; multiple tabs; maximize/restore/close; new file/folder, rename, delete, move and failure feedback; dirty-file save/discard/cancel; save pending/failure/retry |
| `PluginsPage`, `PluginDetailPage` | Catalog/installed/empty/loading/errors; details/install restrictions; skills; install/toggle/uninstall/upgrade pending and failure states | Browse details, install, enable/disable, uninstall, search, upgrade, skill toggle; operation failure/rollback/retry |
| `ExtensionsSection`, `ExtensionPage` | Enabled/disabled/empty/loading/pending/startup error/service error/unavailable surface; content/settings mount, render error/retry, entry/navigation/status bar | Source extension installation and automatic activation, enable/disable, unavailable surface recovery, management |
| `SettingsPage` and its source sections | General, appearance, editor, account, providers, voice, computer, extensions, cloud, about; alternate account and permission states | Traverse all sections; change theme; configure provider; enable/disable computer; open system permissions; sign out |
| `AuthGate` | Code/password/register; invalid input; code cooldown; waitlist/disabled account; dark mode | Register and sign in; input correction; waitlist/disabled responses; sign out |
| `DrivePage`, `DriveSettings`, `DriveStatus` | Project libraries, empty, unconfigured, offline, errors, paused | Open project, creation entry, project management, sync and failure states |
| `VibemonCenter` and bundled pet UI | Home, pull, equipment, album, empty/offline/sync errors/onboarding/insufficient points/draw error | Home navigation, album/equipment, single/multiple draws, insufficient points and errors |
| `PetWindow`, `PetQuickReply` | Actual sprite canvas; idle/running/permission; bubble idle/running/permission/question/error/read-only/no-session/dark | Send and receive; allow/reject; answer a question |
| Auxiliary product windows | Guide; floating draft/conversation/permission; disconnected/connected/running/error gamepad | Main/floating handoff; guide entry and chapter navigation; gamepad entry from the account menu or recommendation |

Full-page stories also expose dark mode, narrow windows and source Controls. The retained detail stories include RTL, scrolling, content retention, panel boundaries and continuous resize checks.

## Audit gap closure (2026-10-26)

- Composer: actual permission-mode selection; image attachment upload/remove/send, size/type rejection; file mentions with success/empty/error results; long-text attachment pending/error/retry; prediction hint/accept/error.
- Main shell: global URL/form elicitation and queued forms across main sections; extension entry/navigation/status/settings; cover/contain/missing wallpaper; Windows/Linux shells; zoom feedback.
- Files: real binary decoders for PDF/DOCX/XLSX/TIFF/audio/video, worksheet switching, corrupt/unsupported files, read errors, save pending/error/retry, create/rename/delete/move interactions and errors.
- Plugins/extensions: pending and rejected install/toggle/uninstall/upgrade operations, source rollback and successful retries; extension provider context and render-error retry repaired.
- Workflows: completed effort selection, project selection plus sending, original-chat return, provider testing, voice save, editor toggle, extension automatic activation and guide chapter navigation. Pure state displays are no longer labeled as interaction journeys.

The three failing extension examples from the initial audit now use the real source providers and assert the current Guide navigation. Native window enumeration follows the installed Tauri API's string-label contract.

Synthetic binary assets are kept under `assets/` and served at `/storybook-fixtures/`. Regenerate them with `bun .storybook/create-preview-assets.mjs` using the installed Playwright browser. No user documents or external network downloads are required.

## Simulation contract

Preview data includes projects, recent and archived conversations, a 32-turn history, tool output, plans, permissions, files and differences, an ALwith profile, Codex usage, six plugins, three skills and three pets. Desktop geometry and movement are simulated in the browser. Pet art, sprites and animation come from the installed package; account and catalog data are simulated.

File operations and edits write to `fixtures/filesystem.ts` in memory. Login, model requests, installation, cloud requests, and window handoffs use isolated preview state. Browser stories do not connect to the user's Runtime, send verification messages, install real extensions, or write project files to disk. External links are mocked. OS dialogs and permissions are represented by their source frontend and mocked responses.

Monaco uses Chromium EditContext. Automated editing dispatches its OS text-update event to the real editor; source save and close handlers still perform the operation. Error toasts stay visible for checkpoint inspection and are cleared between examples. Pet flow tests complete the source video's `ended` event to reach the actual result UI without waiting for the entire clip.

## CI recovery (2026-10-30)

The frozen lockfile now includes the native mobile Linux and gamepad Windows optional artifacts at their existing versions. A script test checks that every native wrapper's platform dependency is represented in the lockfile. Native-artifact tests resolve fixture paths with `fileURLToPath`, including workspace paths containing spaces or Chinese characters. The aggregate source test run passes 90 script tests and 1,482 frontend/engine tests.

Browser tests run in batches of eight files with one worker and a fresh Chromium process per batch. Page assertions run for every page story; workflow assertions replay each complete source journey once. A separate player check verifies the rendered diagrams, isolated checkpoints, navigation geometry, pan/zoom, long settings flows, theme, and narrow viewports. Workflow playback keeps its checkpoint behavior outside the test runner. Local batched runs and focused reruns cover all 369 page cases and 144 source journeys; the final five-file recheck passes all 16 cases. The static player verification also passes.

## Baseline integration verification (2fd356d, 2026-10-30)

The catalog is integrated with `main` at `a94ded5`. It retains Chinese page/feature navigation, complete source page states, 144 workflow diagrams, and shared theme/language controls. New upstream browser bridge, mobile settings, extension controls, plugin catalog, subagent, and app-creation examples are included in the page groups. The current index contains **369 page/component examples + 144 workflow diagrams = 513 sidebar stories**, with 492 embedded workflow checkpoints across 246 generated story files.

The integration adapts adapter-owned session types and list state, shared chat components and drafts, project grouping, host fixtures, the settings-backed theme, and newer drive/pet contracts. Production source, dependencies, and application configuration match the main branch. The synthetic user-agent fixture includes Chromium brand metadata required by the accessibility matcher.

Results recorded at the baseline commit, before the CI recovery above:

- Storybook and application type checks, both static builds, knip, and scoped formatting pass.
- All 1,482 source frontend/engine tests pass across 239 files.
- A browser smoke check passes for 13 representative page families in both light and dark modes (26 checks), including chat, settings, archives, plugins, files, extensions, pets, gamepad, floating chat, mobile settings, browser bridge, and subagents.
- All 38 targeted interaction checks pass across eight generated story files, covering the migrated model menu, app creation, plugin operations, composer recovery, plugin details, image preview, gamepad, and floating chat. Existing contrast findings in the open model menu and app-creation choices are explicit accessibility TODOs; product colors are unchanged.
- The broader page run is not a passing full-catalog result: it encountered browser connection closure and stale canvas/layout assertions against the newer Atlas geometry. The targeted workflow verifier passes navigation geometry/panning/zoom, plugin installation, Guide navigation, and plugin failure recovery, but times out on the later all-settings checkpoint batch. These remaining checks need follow-up before claiming full interaction coverage.
- The aggregate application test command stops at three native-artifact fixture failures caused by encoded Chinese/space path segments (86 script tests pass). This Bun installation has no `lint` command. Neither limitation was fixed as part of the Storybook integration.

## Historical verification

Verified on 2026-10-26: all 374 page/component cases passed across the page-suite run and an isolated-cache rerun of the 16 file-preview cases. The first page-suite run passed 369 cases; five media cases hit concurrent dependency-cache invalidation and passed in the isolated rerun. Storybook type checks, knip, and static build passed. The final static export used a separate temporary output directory to avoid concurrent build writes; its catalog matches the live preview. Product source/configuration fingerprints match the pre-change baseline outside `.storybook/`. Embedded workflow checkpoints are counted separately from sidebar stories.

Catalog: **369 page/component examples + 144 workflow diagrams = 513 sidebar stories**, across 183 story files. The workflow diagrams contain 610 embedded checkpoints. Page/component examples are catalog entries, not a count of distinct product screens. The five standalone patch and computer-preview detail examples were removed at the user's request after the verification run above. Product source tests remain unchanged; their results must be reported separately from Storybook results.

## Verification commands

- `bun run storybook:check`: Storybook and all imported source type checks.
- `bun run storybook:test`: batched Chromium checks for every generated page and workflow journey, followed by the player checks. Run `bun run storybook:build` first; the runner starts and cleans up a static preview on `127.0.0.1:6007` if no preview is already running. Optional path filters, such as `bun run storybook:test page-boards`, limit the browser suite for local diagnosis.
- `bun .storybook/verify-player.mjs`: action labels, 1100px page sizing, a single horizontal row, separate labels, blank-canvas and image dragging, inactive page clicks, a zoom-only toolbar, an unchanged source viewport, stable initial scroll position, source checkpoints, menu/dialog isolation, failure recovery, long flows, narrow viewports, and dark theme. This is a targeted check; it does not run the complete 144-flow batch.
- `bun run storybook:build`: standalone static export in ignored `storybook-static/`.
- `bun run typecheck`, `bun run knip`, `bun run build`: application gates.
- `bun x --no-install vitest run`: source frontend and engine tests.

The source archive delete button also reports 4:1 text contrast against the required 4.5:1; its layout story retains the archive page's explicit accessibility TODO.

The accessibility addon remains available. Full-page fixtures and the existing computer waiting preview report source accessibility findings as TODOs rather than altering source visuals to satisfy the catalog. A passing interaction run is not an accessibility certification.
