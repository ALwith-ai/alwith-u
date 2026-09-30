# Chat branches

The action bar of a finished reply offers "Create chat branch": it keeps the history up to and including the Codex turn that reply belongs to, creates an independent chat and opens it. The headers of the main window and the floating window show no fork entry. The end of the inherited history shows a source divider, and its "Continue in original chat" button returns to the source session. The sidebar's existing "Fork" entry also opens the new chat. The main window and the floating chat window share the ACP client owned by the main window.

When one native turn contains several user messages it can map to several display batches; the source divider goes only after the last display batch of that turn. The reply action bar shows the turn's start time to the right of the fork button, in Desktop's format: hours and minutes for today, month, day, hours and minutes for other dates, and the full date and time on hover. History times come from ACP `_meta.codex.turnStartedAt` (Unix milliseconds); when it is missing, the replay arrival time is never passed off as the history time.

## Protocol

- U uses `session/fork` and passes the boundary in `_meta.codex.lastTurnId`; omitting it means the whole chat. The reply fork entry is shown only when the adapter declares the `forkAtTurn` capability and the reply carries `_meta.codex.turnId`.
- Message IDs and turn IDs differ. The adapter supplies the original turn ID for both live updates and history replay; the UI never guesses from message order.
- The adapter declares `sessionLineage` and returns `_meta.codex.{nativeSessionId, forkedFromId}` in new, resume and fork responses and in session listings.
- A real fork in Codex 0.156.1 produces a different `Thread.sessionId`, so despite its type annotation it cannot serve as a shared tree ID. U gets the direct source session from `forkedFromId` and no longer loads a list of related branches.
- Chats and their branch relations stay owned by Codex; U keeps no second session store.
- Codex 0.156.1's `thread/list` excludes branches whose preview is empty, even after the chat continued. On the first page the adapter reads the `session_meta` of Codex's native rollouts, discovers branches by `forked_from_id`, confirms their summaries through `thread/read` and adds them to the list; it also fills in parent information the native listing can omit once a branch is unloaded. This compatibility logic lives in the adapter, respects archive and project scope, writes no Codex files and keeps no second index, so branches still appear in the session list after a restart.

## Release and verification

The adapter feature branch was created from `440a5427` and the U feature branch from local `main`. The adapter package is installed from npm (`@nyssance/codex-acp-v2`, pinned to an exact version in `package.json`) and is no longer vendored locally.

Automated tests cover parameter pass-through, turn metadata, source sessions across pages, lookups across projects and archives, repeated clicks, retry after failure, asynchronous results after leaving the original chat, and forwarding from the floating window. `bun run test:live` checks, over both the Runtime's stdio and WebSocket transports, forking at a chosen reply, exclusion of later messages, native parent and child relations, reopening a branch, continuing it independently, and branch discovery and history restore under a fresh adapter process.

## Creation timing, title and source

Clicking fork creates and persists the Codex session immediately, without waiting for new input; this differs from Desktop's draft semantics, which write nothing before the first send. The title inherits the source title and increments as `(2)`, `(3)`; titles already taken are skipped, and a source title that already carries a counter keeps incrementing rather than stacking two sets of parentheses. The title is written as the Codex native session name, and the main and floating windows serialize forks through one owner so simultaneous forks do not collide on a name.

The fork and resume responses' `_meta.codex.forkedAtTurnId` is the last turn ID shared by the parent and child native histories. U holds the source only in its in-memory projection and places the divider after that turn's history; new messages in the child session never move it, and after a restart it is restored from the adapter. The divider shows only "Continue in original chat", without the source title, and does not prefetch the source session. On click it prefers an existing session summary and queries the native list for the target directory only when that is missing; when the source session is unavailable or fails to load, a notice says so and the click can be retried.
