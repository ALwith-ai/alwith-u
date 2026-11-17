# Browser executor evaluation

These manual benchmarks run real browser processes. They are deliberately outside the mocked unit-test suite. They never use the user's browser profile or start an agent session.

## Reproduce

Install `agent-browser@0.43.0` in a temporary directory with Bun. Point `AGENT_BROWSER_BIN` at its platform package's native executable. Set `EVAL_CHROME` to an installed Chromium executable, preferably the Playwright headless shell. The runner does not download browsers or change project dependencies.

```sh
AGENT_BROWSER_BIN=/absolute/path/to/agent-browser \
EVAL_CHROME=/absolute/path/to/chrome-headless-shell \
bun tests/benchmarks/browser-executors.mjs
```

`EVAL_REPEATS` defaults to five. `EVAL_CASES` optionally selects comma-separated case names. Evidence is written to the printed temporary directory, including the executed runner source, per-attempt results, fixture observations, and a summary. A test failure is a recorded result, not a nonzero runner exit; inspect the JSON. Infrastructure failures can abort the runner.

Both executors connect over CDP to the same Chromium process and temporary profile, one at a time. Their order alternates per repetition. Every case uses a fresh fixture URL and server-side observation key. Browser state and daemon sockets are isolated. The agent-browser configuration is explicitly empty; no user configuration is loaded. A new page navigation resets each case, and frame selection is reset before agent-browser navigation.

Fixture input and click handlers send observations to an independent HTTP server. Uploaded and downloaded file contents are checked. Tool success messages are not the oracle. No executor may rewrite fixture state to manufacture success. JavaScript evaluation is used only to schedule controlled fixture transitions; upstream wait APIs may observe conditions.

Default-action cases and explicit-wait/reference recipes are separate. A failed default command does not prove that no sequence can complete a task. Ambiguous-selector rejection is an explicit product requirement, not a claim that both upstream tools promise strict matching. Recorded durations include transport and oracle overhead. Output byte counts are diagnostic and **not comparable token measurements**: one adapter returns CLI JSON and the other uses library calls. Concurrent development checks also make this run unsuitable for a latency ranking.

## CEF connection gate

Launch an isolated application with the `ai.alwith.u.contract-test` identity and open its `browser-fixture.html`. Never use the development or release user's application.

```sh
TAURI_HASGARD_SOCKET=/tmp/tauri-hasgard-ai.alwith.u.contract-test.sock \
AGENT_BROWSER_BIN=/absolute/path/to/agent-browser \
bun tests/benchmarks/browser-cef-connect.mjs
```

This creates and closes test guests, binds and revokes temporary sessions, and attempts an observation with each executor. It does not modify the CEF bridge. A connection failure is an integration blocker, not an executor task failure.

## Results: 2026-11-17

Environment: macOS ARM64, agent-browser 0.43.0 (published native package), Playwright 1.65.1, Chromium headless shell 159.0.8154.6. Vendor source inspected separately was commit `b06e2533ba9b3823b8a96c859d455cb55f4d7893`; the benchmark ran the published executable, not a build of that checkout.

| Suite | Playwright | agent-browser |
| --- | --- | --- |
| 25 baseline cases, five repetitions | 125/125 | 75/125 |
| Two supplementary native recipes, five repetitions | 10/10 | 0/10 |
| Existing isolated CEF candidate: connect and observe | Passed | Blocked at `Target.setDiscoverTargets` |

All 250 baseline and 20 supplementary attempts reached the action phase; no setup failures occurred in these recorded suites. Earlier harness probes using ordinary Chrome had startup/navigation timeouts and are not included in these headless-shell results. They were not reclassified as successful attempts.

Key observations:

- Ordinary input, textarea, checkbox, select, upload, same-origin iframe, offscreen click, confirm dialog, save-and-wait, and stale-row-reference rejection passed for both executors in the baseline.
- agent-browser `fill` on a nonempty contenteditable returned success but produced `New draftOriginal draft`. Multiline replacement and `type --clear` also retained the old content. A supplementary click / Meta+A / inserttext recipe also failed this fixture; this does not establish that every possible keyboard recipe fails.
- agent-browser explicitly rejected its `download` command over external CDP. Playwright downloaded and verified the fixture file. This does not establish that CEF downloads behave identically to Chromium downloads.
- agent-browser failed default clicks on covered, delayed, and disabled elements. All three passed with its native explicit waits. Those are command-semantic differences, not absent capabilities.
- agent-browser did not pierce the shadow root with the tested CSS selector; using its observed snapshot reference passed.
- Cross-origin iframe selection/click failed with agent-browser in this fixture. A supplementary snapshot-reference attempt also failed, reporting an out-of-viewport element. No general conclusion about all cross-origin frame arrangements is justified.
- agent-browser accepted a selector matching two buttons and generated a click. Playwright rejected it. The test requires rejection to avoid acting on an ambiguous business object.
- CEF rejected agent-browser target discovery through the current scoped bridge. This is a known integration boundary, independent of the Chromium task results.

Raw observations are in [2026-11-17-results.json](./2026-11-17-results.json). This is a deterministic execution baseline, **not** a model-driven task benchmark, a full CEF comparison, a Windows result, or a global ranking. Real mail/Feishu/admin workflows, takeover/reconnection, and model cost remain unmeasured here.
