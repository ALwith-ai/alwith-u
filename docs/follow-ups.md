# Follow-ups

Open items left by the work of 2026-11-23 and 2026-11-24. Remove an entry when it is done.

## Typing lag on Windows

Fixed by `@alwith/module-chat` 0.6.41 and `@nyssance/atlas` 0.1.13. Measured on one
machine with a development build: 43 characters went from 43 long frames (4048 ms) to
3 long frames (249 ms), none of them from input handling.

- Not verified on the machine that reported the lag, in a release build, or on macOS.
- About 7 ms per keystroke remains from other `:has()` rules in the chat stylesheet.
- `src/hover.ts` in Atlas still reads computed style from a mutation observer on every
  child-list change. Its measured cost is 0 ms now, so it was left unchanged.

## Chat markdown class names

`packages/chat/src/codex/markdown-renderer.tsx` in `alwith-modules` still concatenates
class names without a separating space in three places (image trigger, image, media
paragraph; near lines 699, 705 and 966). The list item had the same defect and is fixed.

## Windows Snap Layout

See [windows-snap-layout-integration.md](windows-snap-layout-integration.md) for the fix.
Unverified: the Wry backend, fullscreen, moving between displays with different scale
factors, and the visible line at the bottom edge.

## Hasgard

- Add real-cursor hover to the MCP server. The CLI has `native-move` on Windows only,
  and `hover` raises DOM hover only, which cannot trigger behaviour owned by the
  operating system such as the Snap Layout flyout.
- Consider screen-region capture for content drawn outside the application window.

## Development tooling

- `fab upgrade` reports newer Rust releases with `cargo outdated`, which resolves a
  rewritten temporary copy of the workspace. `cargo upgrade --dry-run --incompatible
  allow --pinned allow` from cargo-edit reads the manifests only and also reports pinned
  prereleases. The two outputs have not been compared on this repository.
- A bare `cargo clippy` in `src-tauri` fails in the `cef-dll-sys` build script because
  `CEF_PATH` comes from `scripts/desktop.ts`. Clippy and the Rust tests were not run for
  the changes of these two days, and neither were the CI gates listed in `AGENTS.md`.

## History

Commit `d3ab9fb8` is titled "build: i18next 27.2.5, lucide-react 1.78.0 and Rust
dependency updates" but contains the upgrade to `@nyssance/tauri-runtime-cef` 158.1.3
and the removal of its local patch. Correcting the title needs a force push.
