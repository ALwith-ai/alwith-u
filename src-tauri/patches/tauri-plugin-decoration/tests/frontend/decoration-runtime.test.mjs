import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createDomWindow, spy } from "./dom-harness.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const titlebarSource = readFileSync(`${root}/src/js/titlebar.js`, "utf8");
const windowsSource = readFileSync(`${root}/src/js/controls.js`, "utf8");
const linuxSource = readFileSync(`${root}/src/js/linux-controls.js`, "utf8");

const plain = (value) => JSON.parse(JSON.stringify(value));

function createHarness({
  invokeImpl,
  isFullscreen = spy(async () => false),
  isMaximized = spy(async () => false),
  setTimeoutImpl,
  clearTimeoutImpl,
  documentLease = "1",
  inboxLease = null,
} = {}) {
  const window = createDomWindow({ clearTimeoutImpl, setTimeoutImpl });
  window.document.readyState = "loading";
  const consoleError = spy();
  window.console = { ...console, error: consoleError };
  let sentinelReady = false;
  const acknowledgements = [];
  const bootAnnouncements = [];
  const invoke = spy(async (command, args) => {
    if (command === "plugin:decoration|frontend_document_boot") {
      bootAnnouncements.push({ command, args });
      invoke.calls.pop();
    } else {
      acknowledgements.push({ command, args });
    }
    const result = await invokeImpl?.(command, args);
    if (command === "plugin:decoration|frontend_document_boot" && result === undefined) {
      return { status: "registered", documentLease: "1" };
    }
    return command === "plugin:decoration|frontend_geometry" && result === undefined
      ? { applied: true, cursor: args.snapGeometry.sequence }
      : result;
  });
  const windowApi = {
    minimize: spy(async () => {}),
    toggleMaximize: spy(async () => {}),
    close: spy(async () => {}),
    isFullscreen,
    isMaximized,
  };

  window.__TAURI_INTERNALS__ = {
    convertFileSrc: spy(
      () => "tauri-plugin-decoration://localhost/controls.css",
    ),
    invoke,
  };
  window.__TAURI__ = { window: { getCurrentWindow: () => windowApi } };
  window.getComputedStyle = () => ({
    getPropertyValue: (name) =>
      name === "--tauri-plugin-decoration-ready" && sentinelReady ? "ready" : "",
  });

  if (inboxLease !== null) {
    window.__TAURI_PLUGIN_DECORATION_DOCUMENT_LEASE__ = inboxLease;
  }
  window.eval(titlebarSource);
  if (documentLease !== null) {
    assert.equal(
      window.__TAURI_PLUGIN_DECORATION__.bindDocumentLease(documentLease),
      true,
    );
  }
  return {
    acknowledgements,
    bootAnnouncements,
    consoleError,
    invoke,
    loadPlatform(platform) {
      window.eval(platform === "windows" ? windowsSource : linuxSource);
    },
    setSentinelReady(value = true) {
      sentinelReady = value;
    },
    window,
    windowApi,
  };
}

async function stylesheetLink(window) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const link = window.document.querySelector(
      "link[data-tauri-plugin-decoration-stylesheet]",
    );
    if (link) return link;
    await Promise.resolve();
  }
  throw new Error("stylesheet link was not installed");
}

async function waitForCalls(callable, count) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (callable.calls.length >= count) return;
    await Promise.resolve();
  }
  throw new Error(`expected ${count} calls, observed ${callable.calls.length}`);
}

async function waitForCondition(condition, message) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => globalThis.setTimeout(resolve, 10));
  }
  throw new Error(message);
}

function createFakeTimers() {
  const pending = new Map();
  let nextId = 1;
  let now = 0;

  return {
    pending,
    setTimeoutImpl(callback, delay = 0) {
      const id = nextId++;
      pending.set(id, {
        callback,
        canceled: false,
        delay,
        due: now + delay,
      });
      return id;
    },
    clearTimeoutImpl(id) {
      const timer = pending.get(id);
      if (timer) timer.canceled = true;
    },
    advanceNext() {
      const entry = [...pending.entries()]
        .filter(([, timer]) => !timer.canceled)
        .sort(([, left], [, right]) => left.due - right.due)[0];
      assert.ok(entry, "expected an active fake timer");
      pending.delete(entry[0]);
      now = entry[1].due;
      entry[1].callback();
      return entry[1];
    },
  };
}

function config(documentToken, platform = "windows") {
  const value = {
    windowGeneration: "7",
    documentToken: String(documentToken),
    platform,
    controls: ["minimize", "maximize", "close"],
    icons: {
      minimize: "data:image/png;base64,bWlu",
      maximize: "data:image/png;base64,bWF4",
      restore: "data:image/png;base64,cmVzdG9yZQ==",
      close: "data:image/png;base64,Y2xvc2U=",
    },
  };
  if (platform === "linux") {
    value.layout = { left: [], right: [...value.controls] };
  }
  return value;
}

async function loadStylesheet(harness, installed = true) {
  assert.equal(installed, true);
  const expectedAcknowledgements = harness.invoke.calls.length + 1;
  const link = await stylesheetLink(harness.window);
  harness.setSentinelReady();
  link.dispatchEvent(new harness.window.Event("load"));
  await waitForCalls(harness.invoke, expectedAcknowledgements);
  await waitForCondition(
    () =>
      harness.window.document.querySelector(
        "[data-tauri-plugin-decoration-active]",
      ) !== null,
    "decoration did not become active",
  );
}

describe("embedded decoration runtime", () => {
  it("announces readiness after the injected document reaches DOM ready", async () => {
    const harness = createHarness();
    harness.loadPlatform("windows");
    await waitForCondition(
      () => harness.bootAnnouncements.length === 1,
      "the live document did not announce its boot nonce",
    );
    await Promise.resolve();
    assert.equal(
      harness.window.__TAURI_PLUGIN_DECORATION__.challengeDocument("7", "8", "1", "1"),
      true,
    );
    harness.window.document.readyState = "complete";
    harness.window.document.dispatchEvent(
      new harness.window.Event("DOMContentLoaded"),
    );
    await waitForCondition(
      () =>
        harness.acknowledgements.some(
          ({ command }) =>
            command === "plugin:decoration|frontend_document_ready",
        ),
      "the live document did not announce readiness",
    );
  });

  it("announces the static document boot nonce before readiness", async () => {
    const harness = createHarness();
    await waitForCondition(
      () => harness.bootAnnouncements.length === 1,
      "the live document did not announce its boot nonce",
    );
    assert.equal(
      harness.bootAnnouncements[0].args.documentNonce,
      "00000001000000020000000300000004",
    );
    assert.equal(
      Object.hasOwn(harness.bootAnnouncements[0].args, "documentLease"),
      true,
    );
    assert.equal(harness.bootAnnouncements[0].args.documentLease, "1");
  });

  it("waits for the native document lease before announcing boot", async () => {
    const harness = createHarness({ documentLease: null });
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
    assert.equal(harness.bootAnnouncements.length, 0);
    assert.equal(
      harness.window.__TAURI_PLUGIN_DECORATION__.bindDocumentLease("2"),
      true,
    );
    await waitForCondition(
      () => harness.bootAnnouncements.length === 1,
      "the lease-bound document did not announce its boot nonce",
    );
    assert.equal(harness.bootAnnouncements[0].args.documentLease, "2");
  });

  it("consumes a Started-document lease delivered before runtime initialization", async () => {
    const harness = createHarness({ documentLease: null, inboxLease: "2" });
    await waitForCondition(
      () => harness.bootAnnouncements.length === 1,
      "the pre-runtime lease did not start document boot",
    );
    assert.equal(harness.bootAnnouncements[0].args.documentLease, "2");
    assert.equal(
      Object.hasOwn(
        harness.window,
        "__TAURI_PLUGIN_DECORATION_DOCUMENT_LEASE__",
      ),
      false,
    );
  });

  it("retries a transient document boot failure with bounded backoff", async () => {
    const timers = createFakeTimers();
    let attempts = 0;
    const harness = createHarness({
      clearTimeoutImpl: timers.clearTimeoutImpl,
      setTimeoutImpl: timers.setTimeoutImpl,
      invokeImpl(command) {
        if (command !== "plugin:decoration|frontend_document_boot") return undefined;
        attempts += 1;
        return attempts === 1
          ? Promise.reject(new Error("boot unavailable"))
          : undefined;
      },
    });

    await waitForCondition(() => attempts === 1, "the initial boot was not attempted");
    await Promise.resolve();
    await Promise.resolve();
    const retry = [...timers.pending.values()].find((timer) => !timer.canceled);
    assert.equal(retry?.delay, 32);
    timers.advanceNext();
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
    await waitForCondition(() => attempts === 2, "the boot retry was not attempted");
  });

  it("does not accept a delayed boot response after the document ends", async () => {
    let resolveBoot;
    const bootResponse = new Promise((resolve) => {
      resolveBoot = resolve;
    });
    const harness = createHarness({
      invokeImpl(command) {
        return command === "plugin:decoration|frontend_document_boot"
          ? bootResponse
          : undefined;
      },
    });

    await waitForCondition(
      () => harness.bootAnnouncements.length === 1,
      "the initial boot was not attempted",
    );
    harness.window.dispatchEvent(
      new harness.window.Event("pagehide"),
    );
    resolveBoot(null);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(harness.acknowledgements.length, 0);
  });

  it("retries a transient document readiness failure and cancels it on pagehide", async () => {
    const timers = createFakeTimers();
    let readyAttempts = 0;
    const harness = createHarness({
      clearTimeoutImpl: timers.clearTimeoutImpl,
      setTimeoutImpl: timers.setTimeoutImpl,
      invokeImpl(command) {
        if (command === "plugin:decoration|frontend_document_boot") {
          return {
            status: "accepted",
            challenge: {
              challenge: "2",
              documentLease: "1",
              documentToken: "9",
              windowGeneration: "7",
            },
          };
        }
        if (command === "plugin:decoration|frontend_document_ready") {
          readyAttempts += 1;
          return readyAttempts === 1
            ? Promise.reject(new Error("readiness unavailable"))
            : undefined;
        }
        return undefined;
      },
    });
    harness.window.document.readyState = "complete";
    harness.window.document.dispatchEvent(
      new harness.window.Event("DOMContentLoaded"),
    );

    await waitForCondition(
      () => readyAttempts === 1,
      "the initial readiness announcement was not attempted",
    );
    await Promise.resolve();
    await Promise.resolve();
    const retry = [...timers.pending.values()].find((timer) => !timer.canceled);
    assert.equal(retry?.delay, 32);
    harness.window.dispatchEvent(new harness.window.Event("pagehide"));
    assert.ok([...timers.pending.values()].every((timer) => timer.canceled));
    timers.advanceNext = () => {
      throw new Error("cancelled readiness must not schedule another attempt");
    };
  });

  it("suspends a persisted page and resumes the current readiness lease", async () => {
    let readyAttempts = 0;
    const harness = createHarness({
      invokeImpl(command) {
        if (command === "plugin:decoration|frontend_document_boot") {
          return {
            status: "accepted",
            challenge: {
              challenge: "2",
              documentLease: "1",
              documentToken: "9",
              windowGeneration: "7",
            },
          };
        }
        if (command === "plugin:decoration|frontend_document_ready") {
          readyAttempts += 1;
          return readyAttempts === 1 ? new Promise(() => {}) : undefined;
        }
        return undefined;
      },
    });
    harness.window.document.readyState = "complete";
    harness.window.document.dispatchEvent(
      new harness.window.Event("DOMContentLoaded"),
    );
    await waitForCondition(
      () => readyAttempts === 1,
      "the initial readiness announcement was not attempted",
    );

    harness.window.dispatchEvent(
      new harness.window.Event("pagehide", { persisted: true }),
    );
    harness.window.dispatchEvent(
      new harness.window.Event("pageshow", { persisted: true }),
    );

    await waitForCondition(
      () => readyAttempts === 2,
      "the persisted document did not resume its current readiness lease",
    );
    assert.equal(harness.bootAnnouncements.length, 2);
  });

  it("terminates document retries after a non-persisted pagehide", async () => {
    const timers = createFakeTimers();
    const harness = createHarness({
      clearTimeoutImpl: timers.clearTimeoutImpl,
      setTimeoutImpl: timers.setTimeoutImpl,
      invokeImpl(command) {
        if (command === "plugin:decoration|frontend_document_boot") {
          return Promise.reject(new Error("boot unavailable"));
        }
        return undefined;
      },
    });
    await waitForCondition(() => timers.pending.size > 0, "the boot retry was not scheduled");
    harness.window.dispatchEvent(new harness.window.Event("pagehide"));
    harness.window.dispatchEvent(new harness.window.Event("pageshow", { persisted: true }));
    assert.ok([...timers.pending.values()].every((timer) => timer.canceled));
  });

  it("uses the invoking document boot response to challenge readiness", async () => {
    const harness = createHarness({
      invokeImpl(command) {
        if (command === "plugin:decoration|frontend_document_boot") {
          return {
            status: "accepted",
            challenge: {
              challenge: "2",
              documentToken: "9",
              windowGeneration: "7",
              documentLease: "1",
            },
          };
        }
        return undefined;
      },
    });
    harness.window.document.readyState = "complete";
    harness.window.document.dispatchEvent(
      new harness.window.Event("DOMContentLoaded"),
    );
    await waitForCondition(
      () =>
        harness.acknowledgements.some(
          ({ command, args }) =>
            command === "plugin:decoration|frontend_document_ready" &&
            args.documentToken === "9",
        ),
      "the boot response did not challenge the invoking document",
    );
  });

  it("installs only after a nonce challenge reaches the live document", async () => {
    const harness = createHarness();
    harness.loadPlatform("windows");
    const runtime = harness.window.__TAURI_PLUGIN_DECORATION__;
    const liveNonce = "00000001000000020000000300000004";
    await waitForCondition(
      () => harness.bootAnnouncements.length === 1,
      "the live document did not announce its boot nonce",
    );
    await Promise.resolve();
    assert.equal(runtime.challengeDocument("7", "9", "2", "1"), true);

    assert.equal(runtime.installForDocument("f".repeat(32), "2", config(9)), false);
    assert.equal(
      harness.window.document.querySelector("[data-tauri-decoration-root]"),
      null,
    );
    await loadStylesheet(
      harness,
      runtime.installForDocument(liveNonce, "2", config(9)),
    );
  });

  it("waits for the fixed stylesheet and reports measured maximize geometry before acknowledgement", async () => {
    const isMaximized = spy(async () => true);
    const harness = createHarness({ isMaximized });
    harness.loadPlatform("windows");

    const installation = config(11);
    installation.maximized = true;
    assert.equal(
      harness.window.__TAURI_PLUGIN_DECORATION__.install(installation),
      true,
    );
    await stylesheetLink(harness.window);
    assert.equal(harness.invoke.calls.length, 0);

    await loadStylesheet(harness);
    assert.deepEqual(plain(harness.acknowledgements), [
      {
        command: "plugin:decoration|frontend_ack",
        args: {
          windowGeneration: "7",
          documentToken: "11",
          ok: true,
          errorCode: null,
          snapGeometry: {
            kind: "geometry",
            sequence: "1",
            geometry: {
              controlBandWidth: 174,
              height: 32,
              titlebarHeight: 32,
              width: 58,
              x: 684,
              y: 0,
            },
          },
        },
      },
    ]);
    assert.equal(isMaximized.calls.length, 0);

    const maximize = harness.window.document.querySelector(
      '[data-tauri-decoration-control="maximize"]',
    );
    assert.ok(maximize);
    assert.equal(maximize.getAttribute("type"), "button");
    assert.equal(maximize.getAttribute("aria-label"), "Restore window size");
    assert.equal(maximize.textContent, "\uE923");
    assert.equal(
      harness.window.document.documentElement.style.getPropertyValue(
        "--tauri-plugin-decoration-right-clearance",
      ),
      "174px",
    );
    assert.ok(
      harness.window.document.querySelector(
        "[data-tauri-plugin-decoration-active]",
      ),
    );
  });

  it("caches ResizeObserver measurements until native activation commits", async () => {
    let resolveAcknowledgement;
    const acknowledgement = new Promise((resolve) => {
      resolveAcknowledgement = resolve;
    });
    const harness = createHarness({
      invokeImpl(command) {
        return command === "plugin:decoration|frontend_ack"
          ? acknowledgement
          : undefined;
      },
    });
    harness.loadPlatform("windows");
    assert.equal(
      harness.window.__TAURI_PLUGIN_DECORATION__.install(config(12)),
      true,
    );
    const link = await stylesheetLink(harness.window);
    harness.setSentinelReady();
    link.dispatchEvent(new harness.window.Event("load"));
    await waitForCondition(
      () =>
        harness.acknowledgements.some(
          ({ command }) => command === "plugin:decoration|frontend_ack",
        ),
      "native acknowledgement was not requested",
    );

    for (let update = 0; update < 5; update += 1) {
      harness.window.flushResizeObservers();
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
    assert.equal(
      harness.acknowledgements.filter(
        ({ command }) => command === "plugin:decoration|frontend_geometry",
      ).length,
      0,
    );

    globalThis.setTimeout(resolveAcknowledgement, 0);
    await waitForCondition(
      () =>
        harness.window.document.querySelector(
          "[data-tauri-plugin-decoration-active]",
        ) !== null,
      "native activation acknowledgement was starved",
    );
    await waitForCondition(
      () =>
        harness.acknowledgements.filter(
          ({ command }) => command === "plugin:decoration|frontend_geometry",
        ).length === 1,
      "the cached measurement was not flushed once",
    );
  });

  it("completes stylesheet readiness while hidden pages suspend animation frames", async () => {
    let timeoutCallback;
    const harness = createHarness({
      setTimeoutImpl(callback) {
        timeoutCallback = callback;
        return 1;
      },
    });
    const suspendedAnimationFrames = spy();
    harness.window.requestAnimationFrame = suspendedAnimationFrames;
    harness.loadPlatform("windows");

    assert.equal(
      harness.window.__TAURI_PLUGIN_DECORATION__.install(config(12)),
      true,
    );
    const link = await stylesheetLink(harness.window);
    harness.setSentinelReady();
    link.dispatchEvent(new harness.window.Event("load"));
    await waitForCalls(harness.invoke, 1);

    assert.equal(typeof timeoutCallback, "function");
    assert.equal(suspendedAnimationFrames.calls.length, 0);
    assert.equal(harness.acknowledgements[0].args.ok, true);
  });

  it("acknowledges stylesheet failure and removes every partial owned node", async () => {
    const harness = createHarness();
    harness.loadPlatform("windows");
    assert.equal(
      harness.window.__TAURI_PLUGIN_DECORATION__.install(config(12)),
      true,
    );
    const link = await stylesheetLink(harness.window);

    link.dispatchEvent(new harness.window.Event("error"));
    await waitForCalls(harness.invoke, 1);
    assert.deepEqual(plain(harness.acknowledgements[0]), {
      command: "plugin:decoration|frontend_ack",
      args: {
        windowGeneration: "7",
        documentToken: "12",
        ok: false,
        errorCode: "stylesheet-load",
        snapGeometry: null,
      },
    });
    assert.equal(
      harness.window.document.querySelector("[data-tauri-plugin-decoration-owned]"),
      null,
    );
  });

  it("cancels only the exact pending installation and removes owned resources", async () => {
    const harness = createHarness();
    harness.loadPlatform("windows");
    assert.equal(
      harness.window.__TAURI_PLUGIN_DECORATION__.install(config(14)),
      true,
    );
    await stylesheetLink(harness.window);

    const runtime = harness.window.__TAURI_PLUGIN_DECORATION__;
    assert.equal(runtime.cancel("7", "13"), false);
    assert.equal(runtime.cancel("7", "14"), true);
    assert.equal(
      harness.window.document.querySelector("[data-tauri-plugin-decoration-owned]"),
      null,
    );
  });

  it("clears owned titlebar space when an active installation is cancelled", async () => {
    const harness = createHarness();
    harness.loadPlatform("windows");
    await loadStylesheet(
      harness,
      harness.window.__TAURI_PLUGIN_DECORATION__.install(config(15)),
    );
    const style = harness.window.document.documentElement.style;
    assert.equal(
      style.getPropertyValue("--tauri-plugin-decoration-right-clearance"),
      "174px",
    );

    assert.equal(harness.window.__TAURI_PLUGIN_DECORATION__.cancel("7", "15"), true);
    assert.equal(
      style.getPropertyValue("--tauri-plugin-decoration-right-clearance"),
      "",
    );
    assert.equal(
      harness.window.document.querySelector("[data-tauri-plugin-decoration-owned]"),
      null,
      "restoration must remove the loaded plugin stylesheet as well as the controls",
    );
  });

  it("bounds stylesheet preparation before a hidden-window fallback can show", async () => {
    let timeoutCallback;
    const harness = createHarness({
      setTimeoutImpl(callback) {
        timeoutCallback = callback;
        return 1;
      },
    });
    harness.loadPlatform("windows");
    assert.equal(
      harness.window.__TAURI_PLUGIN_DECORATION__.install(config(13)),
      true,
    );
    await stylesheetLink(harness.window);

    assert.equal(typeof timeoutCallback, "function");
    timeoutCallback();
    await waitForCalls(harness.invoke, 1);
    assert.equal(harness.acknowledgements[0].args.ok, false);
    assert.equal(
      harness.window.document.querySelector(
        "link[data-tauri-plugin-decoration-stylesheet]",
      ),
      null,
    );
  });

  it("restores the exact application-owned clearance value and priority", async () => {
    const harness = createHarness();
    harness.loadPlatform("windows");
    const property = "--tauri-plugin-decoration-right-clearance";
    harness.window.document.documentElement.style.setProperty(
      property,
      "42px",
      "important",
    );

    const installed =
      harness.window.__TAURI_PLUGIN_DECORATION__.install(config(12));
    await loadStylesheet(harness, installed);
    assert.notEqual(
      harness.window.document.documentElement.style.getPropertyValue(property),
      "42px",
    );

    assert.equal(
      harness.window.__TAURI_PLUGIN_DECORATION__.cancel("7", "12"),
      true,
    );
    assert.equal(
      harness.window.document.documentElement.style.getPropertyValue(property),
      "42px",
    );
    assert.equal(
      harness.window.document.documentElement.style.getPropertyPriority(property),
      "important",
    );
  });

  it("does not remove a matching application-owned stylesheet", async () => {
    const harness = createHarness();
    harness.loadPlatform("windows");
    const link = harness.window.document.createElement("link");
    link.setAttribute("rel", "stylesheet");
    link.setAttribute(
      "href",
      "tauri-plugin-decoration://localhost/controls.css",
    );
    link.setAttribute("data-tauri-plugin-decoration-stylesheet", "v1");
    harness.window.document.head.appendChild(link);
    harness.setSentinelReady();

    assert.equal(
      harness.window.__TAURI_PLUGIN_DECORATION__.install(config(13)),
      true,
    );
    await waitForCalls(harness.invoke, 1);
    assert.equal(
      harness.window.__TAURI_PLUGIN_DECORATION__.cancel("7", "13"),
      true,
    );
    assert.equal(link.parentNode, harness.window.document.head);
  });

  it("reports a stylesheet conflict without removing the application-owned stylesheet", async () => {
    const harness = createHarness();
    harness.loadPlatform("windows");
    const link = harness.window.document.createElement("link");
    link.setAttribute("rel", "stylesheet");
    link.setAttribute("href", "data:text/css,/* application-owned conflict */");
    link.setAttribute("data-tauri-plugin-decoration-stylesheet", "v1");
    harness.window.document.head.appendChild(link);

    assert.equal(
      harness.window.__TAURI_PLUGIN_DECORATION__.install(config(14)),
      true,
    );
    await waitForCalls(harness.invoke, 1);

    assert.deepEqual(plain(harness.acknowledgements[0]), {
      command: "plugin:decoration|frontend_ack",
      args: {
        windowGeneration: "7",
        documentToken: "14",
        ok: false,
        errorCode: "stylesheet-conflict",
        snapGeometry: null,
      },
    });
    assert.deepEqual(
      plain(harness.window.__TAURI_PLUGIN_DECORATION__.status()),
      {
        errorCode: "stylesheet-conflict",
        phase: "failed",
      },
    );
    assert.equal(link.parentNode, harness.window.document.head);
  });

  it("reports a typed failed status when Tauri IPC is unavailable", async () => {
    const harness = createHarness();
    harness.loadPlatform("windows");
    delete harness.window.__TAURI_INTERNALS__;

    assert.equal(
      harness.window.__TAURI_PLUGIN_DECORATION__.install(config(14)),
      true,
    );
    await waitForCondition(
      () =>
        harness.window.__TAURI_PLUGIN_DECORATION__.status?.().phase === "failed",
      "missing failed runtime status",
    );
    assert.deepEqual(
      plain(harness.window.__TAURI_PLUGIN_DECORATION__.status()),
      {
        errorCode: "tauri-internals-unavailable",
        phase: "failed",
      },
    );
  });

  it("uses controls-only composition", async () => {
    const harness = createHarness();
    harness.loadPlatform("windows");

    const installed =
      harness.window.__TAURI_PLUGIN_DECORATION__.install(config(15));
    await loadStylesheet(harness, installed);

    assert.equal(
      harness.window.document.querySelector(
        "[data-tauri-decoration-drag-region]",
      ),
      null,
    );
  });

  it("does not install the privileged runtime in remote documents or subframes", () => {
    const remote = createDomWindow();
    remote.location = { hostname: "example.com", protocol: "https:" };
    remote.eval(titlebarSource);
    assert.equal(remote.__TAURI_PLUGIN_DECORATION__, undefined);

    const child = createDomWindow();
    child.top = {};
    child.eval(titlebarSource);
    assert.equal(child.__TAURI_PLUGIN_DECORATION__, undefined);
  });

  it("routes controls without exposing window.__TAURI__", async () => {
    const harness = createHarness();
    delete harness.window.__TAURI__;
    harness.loadPlatform("windows");
    await loadStylesheet(
      harness,
      harness.window.__TAURI_PLUGIN_DECORATION__.install(config(16)),
    );

    harness.window.document
      .querySelector('[data-tauri-decoration-control="close"]')
      .dispatchEvent(new harness.window.Event("click"));
    await waitForCondition(
      () =>
        harness.acknowledgements.some(
          ({ command, args }) =>
            command === "plugin:decoration|window_control" &&
            args.action === "close",
        ),
      "the close action did not use the plugin command",
    );
  });

  it("prevents an old document from overwriting the current control snapshot", async () => {
    const harness = createHarness();
    harness.loadPlatform("windows");

    await loadStylesheet(
      harness,
      harness.window.__TAURI_PLUGIN_DECORATION__.install(config(20)),
    );
    const replacement = config(21);
    replacement.maximized = true;
    await loadStylesheet(
      harness,
      harness.window.__TAURI_PLUGIN_DECORATION__.install(replacement),
    );

    const maximize = harness.window.document.querySelector(
      '[data-tauri-decoration-control="maximize"]',
    );
    assert.equal(maximize.getAttribute("aria-label"), "Restore window size");
    assert.equal(
      harness.acknowledgements.filter(({ args }) => args.ok).length,
      2,
    );
    assert.equal(harness.acknowledgements.at(-1).args.documentToken, "21");
  });

  it("routes only closed events for the exact active target", async () => {
    const harness = createHarness();
    harness.loadPlatform("windows");
    const installation = harness.window.__TAURI_PLUGIN_DECORATION__.install(config(30));
    await loadStylesheet(harness, installation);

    const runtime = harness.window.__TAURI_PLUGIN_DECORATION__;
    assert.equal(runtime.dispatch("7", "29", "snap-click", null), false);
    assert.equal(runtime.dispatch("7", "30", "unknown", null), false);
    assert.equal(runtime.dispatch("7", "30", "snap-click", null), true);
    await waitForCondition(
      () =>
        harness.acknowledgements.some(
          ({ command, args }) =>
            command === "plugin:decoration|window_control" &&
            args.action === "toggleMaximize",
        ),
      "Snap click did not invoke the plugin window-control command",
    );
  });

  it("reports Windows action failures and allows a later retry", async () => {
    let denied = true;
    const harness = createHarness({
      invokeImpl: async (command, args) => {
        if (
          command === "plugin:decoration|window_control" &&
          args.action === "minimize" &&
          denied
        ) {
          denied = false;
          throw new Error("denied");
        }
      },
    });
    harness.loadPlatform("windows");
    await loadStylesheet(
      harness,
      harness.window.__TAURI_PLUGIN_DECORATION__.install(config(31)),
    );

    const minimize = harness.window.document.querySelector(
      '[data-tauri-decoration-control="minimize"]',
    );
    minimize.dispatchEvent(new harness.window.Event("click"));
    await waitForCalls(harness.consoleError, 1);

    assert.match(harness.consoleError.calls[0][0], /Windows minimize action failed/);
    assert.equal(minimize.getAttribute("disabled"), null);

    minimize.dispatchEvent(new harness.window.Event("click"));
    await waitForCondition(
      () =>
        harness.acknowledgements.filter(
          ({ command, args }) =>
            command === "plugin:decoration|window_control" &&
            args.action === "minimize",
        ).length === 2,
      "a second minimize request was not sent",
    );
  });

  it("hides Windows controls and clearances for backend window-state events", async () => {
    const harness = createHarness();
    harness.loadPlatform("windows");
    await loadStylesheet(
      harness,
      harness.window.__TAURI_PLUGIN_DECORATION__.install(config(32)),
    );

    const root = harness.window.document.querySelector(
      "[data-tauri-plugin-decoration-root]",
    );
    const style = harness.window.document.documentElement.style;

    harness.window.__TAURI_PLUGIN_DECORATION__.dispatch(
      "7",
      "32",
      "window-state",
      { maximized: false, fullscreen: true, revision: 1 },
    );
    assert.equal(root.getAttribute("data-tauri-decoration-fullscreen"), "");
    assert.equal(
      style.getPropertyValue("--tauri-plugin-decoration-right-clearance"),
      "0px",
    );

    harness.window.__TAURI_PLUGIN_DECORATION__.dispatch(
      "7",
      "32",
      "window-state",
      { maximized: false, fullscreen: false, revision: 2 },
    );
    assert.equal(root.getAttribute("data-tauri-decoration-fullscreen"), null);
    assert.equal(
      style.getPropertyValue("--tauri-plugin-decoration-right-clearance"),
      "174px",
    );
    harness.window.__TAURI_PLUGIN_DECORATION__.dispatch(
      "7",
      "32",
      "window-state",
      { maximized: true, fullscreen: true, revision: 1 },
    );
    assert.equal(root.getAttribute("data-tauri-decoration-fullscreen"), null);
  });

  it("uses backend-provided Windows fullscreen state when no Snap overlay is installed", async () => {
    const isFullscreen = spy(async () => true);
    const harness = createHarness({ isFullscreen });
    harness.loadPlatform("windows");
    const options = config(33);
    options.controls = ["minimize", "close"];
    options.fullscreen = true;
    await loadStylesheet(
      harness,
      harness.window.__TAURI_PLUGIN_DECORATION__.install(options),
    );

    const root = harness.window.document.querySelector(
      "[data-tauri-plugin-decoration-root]",
    );
    const style = harness.window.document.documentElement.style;
    assert.equal(root.getAttribute("data-tauri-decoration-fullscreen"), "");
    assert.equal(
      style.getPropertyValue("--tauri-plugin-decoration-right-clearance"),
      "0px",
    );

    harness.window.__TAURI_PLUGIN_DECORATION__.dispatch(
      "7",
      "33",
      "window-state",
      { maximized: false, fullscreen: false, revision: 1 },
    );
    assert.equal(root.getAttribute("data-tauri-decoration-fullscreen"), null);
    assert.equal(
      style.getPropertyValue("--tauri-plugin-decoration-right-clearance"),
      "116px",
    );
    assert.equal(isFullscreen.calls.length, 0);
  });

  it("reports measured Win32 geometry at 300% DPI in physical pixels", async () => {
    const harness = createHarness();
    harness.window.devicePixelRatio = 3;
    harness.loadPlatform("windows");
    await loadStylesheet(
      harness,
      harness.window.__TAURI_PLUGIN_DECORATION__.install(config(31)),
    );

    const acknowledgement = harness.acknowledgements.find(
      ({ command }) => command === "plugin:decoration|frontend_ack",
    );
    assert.deepEqual(plain(acknowledgement.args.snapGeometry), {
      kind: "geometry",
      sequence: "1",
      geometry: {
        controlBandWidth: 522,
        height: 96,
        titlebarHeight: 96,
        width: 174,
        x: 2052,
        y: 0,
      },
    });
  });

  it("derives shared physical edges for fractional-DPI maximize rectangles", async () => {
    const scales = [1, 1.25, 1.5, 1.75, 2, 3];
    const cases = [
      {
        bandLeft: 742,
        bandRight: 800,
        controls: ["maximize"],
        left: 742,
        right: 800,
      },
      {
        bandLeft: 684,
        bandRight: 800,
        controls: ["minimize", "maximize"],
        left: 742,
        right: 800,
      },
      {
        bandLeft: 684,
        bandRight: 800,
        controls: ["maximize", "close"],
        left: 684,
        right: 742,
      },
      {
        bandLeft: 626,
        bandRight: 800,
        controls: ["minimize", "maximize", "close"],
        left: 684,
        right: 742,
      },
    ];
    let token = 70;

    for (const scale of scales) {
      for (const { bandLeft, bandRight, controls, left, right } of cases) {
        const harness = createHarness();
        harness.window.devicePixelRatio = scale;
        harness.loadPlatform("windows");
        const options = config(String(token));
        options.controls = controls;
        token += 1;
        await loadStylesheet(
          harness,
          harness.window.__TAURI_PLUGIN_DECORATION__.install(options),
        );

        const update = harness.acknowledgements.find(
          ({ command }) => command === "plugin:decoration|frontend_ack",
        ).args.snapGeometry;
        const physicalLeft = Math.round(left * scale);
        const physicalRight = Math.round(right * scale);
        const physicalBottom = Math.round(32 * scale);
        assert.deepEqual(plain(update), {
          kind: "geometry",
          sequence: "1",
          geometry: {
            controlBandWidth:
              Math.round(bandRight * scale) - Math.round(bandLeft * scale),
            height: physicalBottom,
            titlebarHeight: physicalBottom,
            width: physicalRight - physicalLeft,
            x: physicalLeft,
            y: 0,
          },
        });
      }
    }
  });

  it("delivers valid, disabled, and valid geometry states in sequence order", async () => {
    const harness = createHarness();
    harness.loadPlatform("windows");
    await loadStylesheet(
      harness,
      harness.window.__TAURI_PLUGIN_DECORATION__.install(config(110)),
    );
    harness.acknowledgements.length = 0;
    const maximize = harness.window.document.querySelector(
      '[data-tauri-decoration-control="maximize"]',
    );
    const updates = () =>
      harness.acknowledgements.filter(
        ({ command }) => command === "plugin:decoration|frontend_geometry",
      );

    harness.window.flushResizeObservers();
    await waitForCondition(
      () => updates().length >= 1,
      "the initial geometry state was not delivered",
    );
    maximize._boundingClientRect = {
      height: 0,
      left: 0,
      top: 0,
      width: 0,
    };
    harness.window.flushResizeObservers();
    await waitForCondition(
      () => updates().at(-1)?.args.snapGeometry.kind === "disabled",
      "the disabled geometry state was not delivered",
    );
    maximize._boundingClientRect = {
      height: 32,
      left: 620,
      top: 0,
      width: 58,
    };
    harness.window.flushResizeObservers();
    await waitForCondition(
      () => updates().at(-1)?.args.snapGeometry.kind === "geometry",
      "the replacement geometry state was not delivered",
    );

    const sequences = updates().map(({ args }) => Number(args.snapGeometry.sequence));
    assert.ok(sequences.every((sequence, index) => index === 0 || sequence > sequences[index - 1]));
    assert.equal(updates().at(-1).args.snapGeometry.geometry.x, 620);
  });

  it("resynchronizes a stale geometry receipt without an immediate IPC loop", async () => {
    let geometryCalls = 0;
    const harness = createHarness({
      invokeImpl(command, args) {
        if (command !== "plugin:decoration|frontend_geometry") return undefined;
        geometryCalls += 1;
        return geometryCalls === 1
          ? { applied: false, cursor: "1" }
          : { applied: true, cursor: args.snapGeometry.sequence };
      },
    });
    harness.loadPlatform("windows");
    await loadStylesheet(
      harness,
      harness.window.__TAURI_PLUGIN_DECORATION__.install(config(1101)),
    );
    harness.acknowledgements.length = 0;

    harness.window.flushResizeObservers();
    await waitForCondition(() => geometryCalls === 2, "stale geometry was not retried");
    const sequences = harness.acknowledgements
      .filter(({ command }) => command === "plugin:decoration|frontend_geometry")
      .map(({ args }) => args.snapGeometry.sequence);
    assert.deepEqual(sequences, ["2", "2"]);
    await new Promise((resolve) => globalThis.setTimeout(resolve, 25));
    assert.equal(geometryCalls, 2);

    const maximize = harness.window.document.querySelector(
      '[data-tauri-decoration-control="maximize"]',
    );
    maximize._boundingClientRect = {
      height: 32,
      left: 620,
      top: 0,
      width: 58,
    };
    harness.window.flushResizeObservers();
    await waitForCondition(
      () => geometryCalls === 3,
      "the post-resync geometry was not delivered",
    );
    const latest = harness.acknowledgements.filter(
      ({ command }) => command === "plugin:decoration|frontend_geometry",
    );
    assert.deepEqual(
      latest.map(({ args }) => args.snapGeometry.sequence),
      ["2", "2", "3"],
    );
    assert.equal(latest.at(-1).args.snapGeometry.geometry.x, 620);
  });

  it("does not publish Snap geometry when no maximize control is authorized", async () => {
    const harness = createHarness();
    harness.loadPlatform("windows");
    const noMaximize = config(111);
    noMaximize.controls = ["minimize", "close"];
    await loadStylesheet(
      harness,
      harness.window.__TAURI_PLUGIN_DECORATION__.install(noMaximize),
    );
    harness.acknowledgements.length = 0;

    for (let update = 0; update < 4; update += 1) {
      harness.window.flushResizeObservers();
      harness.window.__TAURI_PLUGIN_DECORATION__.dispatch(
        "7",
        "111",
        "window-state",
        { fullscreen: update % 2 === 0, maximized: false, revision: update + 1 },
      );
    }
    await Promise.resolve();

    assert.equal(
      harness.acknowledgements.filter(
        ({ command }) => command === "plugin:decoration|frontend_geometry",
      ).length,
      0,
    );
    assert.deepEqual(plain(harness.window.__TAURI_PLUGIN_DECORATION__.status()), {
      errorCode: null,
      phase: "active",
    });
  });

  it("coalesces rapid valid-disabled-valid updates to the newest state", async () => {
    let releaseFirst;
    let geometryCalls = 0;
    const firstReport = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    const harness = createHarness({
      invokeImpl(command) {
        if (command !== "plugin:decoration|frontend_geometry") return undefined;
        geometryCalls += 1;
        return geometryCalls === 1 ? firstReport : undefined;
      },
    });
    harness.loadPlatform("windows");
    await loadStylesheet(
      harness,
      harness.window.__TAURI_PLUGIN_DECORATION__.install(config(115)),
    );
    harness.acknowledgements.length = 0;
    const maximize = harness.window.document.querySelector(
      '[data-tauri-decoration-control="maximize"]',
    );
    harness.window.flushResizeObservers();
    await waitForCondition(
      () => geometryCalls === 1,
      "the first geometry state was not sent",
    );
    maximize._boundingClientRect = {
      height: 0,
      left: 0,
      top: 0,
      width: 0,
    };
    harness.window.flushResizeObservers();
    maximize._boundingClientRect = {
      height: 32,
      left: 620,
      top: 0,
      width: 58,
    };
    harness.window.flushResizeObservers();
    releaseFirst();
    await waitForCondition(
      () => geometryCalls >= 2,
      "the newest geometry state was not sent",
    );
    const update = harness.acknowledgements.at(-1).args.snapGeometry;
    assert.equal(update.kind, "geometry");
    assert.equal(update.geometry.x, 620);
  });

  it("retries the exact geometry payload after the in-flight state rejects", async () => {
    let rejectFirst;
    let geometryCalls = 0;
    const firstReport = new Promise((_, reject) => {
      rejectFirst = reject;
    });
    const harness = createHarness({
      invokeImpl(command) {
        if (command !== "plugin:decoration|frontend_geometry") return undefined;
        geometryCalls += 1;
        return geometryCalls === 1 ? firstReport : undefined;
      },
    });
    harness.loadPlatform("windows");
    await loadStylesheet(
      harness,
      harness.window.__TAURI_PLUGIN_DECORATION__.install(config(120)),
    );
    harness.acknowledgements.length = 0;
    harness.window.flushResizeObservers();
    await waitForCondition(
      () => geometryCalls === 1,
      "the rejected geometry state was not sent",
    );
    const firstGeometry = plain(
      harness.acknowledgements.at(-1).args.snapGeometry,
    );
    const maximize = harness.window.document.querySelector(
      '[data-tauri-decoration-control="maximize"]',
    );
    maximize._boundingClientRect = {
      height: 32,
      left: 620,
      top: 0,
      width: 58,
    };
    harness.window.flushResizeObservers();
    rejectFirst(new Error("geometry rejected"));
    await waitForCondition(
      () => geometryCalls >= 2,
      "the failed geometry state was not retried",
    );
    const updates = harness.acknowledgements
      .filter(
        ({ command }) => command === "plugin:decoration|frontend_geometry",
      )
      .map(({ args }) => plain(args.snapGeometry));
    assert.deepEqual(updates.slice(0, 2), [firstGeometry, firstGeometry]);
  });

  it("keeps active status during the transient geometry retry window", async () => {
    let rejectFirst;
    const firstReport = new Promise((_, reject) => {
      rejectFirst = reject;
    });
    let geometryCalls = 0;
    const harness = createHarness({
      invokeImpl(command) {
        if (command !== "plugin:decoration|frontend_geometry") return undefined;
        geometryCalls += 1;
        return geometryCalls === 1 ? firstReport : undefined;
      },
    });
    harness.loadPlatform("windows");
    await loadStylesheet(
      harness,
      harness.window.__TAURI_PLUGIN_DECORATION__.install(config(121)),
    );
    harness.window.flushResizeObservers();
    await waitForCondition(() => geometryCalls === 1, "geometry was not sent");
    rejectFirst(new Error("transient geometry failure"));
    await waitForCondition(
      () => harness.consoleError.calls.length === 1,
      "transient failure was not observed",
    );

    assert.deepEqual(plain(harness.window.__TAURI_PLUGIN_DECORATION__.status()), {
      errorCode: null,
      phase: "active",
    });
  });

  it("clears degraded status when a newer legitimate disabled state succeeds", async () => {
    let rejectFirst;
    let geometryCalls = 0;
    const firstReport = new Promise((_, reject) => {
      rejectFirst = reject;
    });
    const harness = createHarness({
      invokeImpl(command) {
        if (command !== "plugin:decoration|frontend_geometry") return undefined;
        geometryCalls += 1;
        return geometryCalls === 1 ? firstReport : undefined;
      },
    });
    harness.loadPlatform("windows");
    await loadStylesheet(
      harness,
      harness.window.__TAURI_PLUGIN_DECORATION__.install(config(125)),
    );
    harness.acknowledgements.length = 0;
    harness.window.flushResizeObservers();
    await waitForCondition(
      () => geometryCalls === 1,
      "the first geometry state was not sent",
    );
    const maximize = harness.window.document.querySelector(
      '[data-tauri-decoration-control="maximize"]',
    );
    maximize._boundingClientRect = {
      height: 0,
      left: 0,
      top: 0,
      width: 0,
    };
    harness.window.flushResizeObservers();
    rejectFirst(new Error("geometry rejected"));
    await waitForCondition(
      () =>
        geometryCalls >= 2 &&
        harness.window.__TAURI_PLUGIN_DECORATION__.status().phase === "active" &&
        harness.window.__TAURI_PLUGIN_DECORATION__.status().errorCode === null,
      "the newer disabled state was not reconciled",
    );
    assert.equal(harness.acknowledgements.at(-1).args.snapGeometry.kind, "disabled");
    assert.equal(harness.acknowledgements.at(-1).args.snapGeometry.fallback, false);
    assert.deepEqual(plain(harness.window.__TAURI_PLUGIN_DECORATION__.status()), {
      errorCode: null,
      phase: "active",
    });
  });

  it("retries a disabled state after the preceding geometry state rejects", async () => {
    let rejectFirst;
    let geometryCalls = 0;
    const firstReport = new Promise((_, reject) => {
      rejectFirst = reject;
    });
    const harness = createHarness({
      invokeImpl(command) {
        if (command !== "plugin:decoration|frontend_geometry") return undefined;
        geometryCalls += 1;
        return geometryCalls === 1 ? firstReport : undefined;
      },
    });
    harness.loadPlatform("windows");
    await loadStylesheet(
      harness,
      harness.window.__TAURI_PLUGIN_DECORATION__.install(config(130)),
    );
    harness.acknowledgements.length = 0;
    harness.window.flushResizeObservers();
    await waitForCondition(
      () => geometryCalls === 1,
      "the rejected geometry state was not sent",
    );
    const maximize = harness.window.document.querySelector(
      '[data-tauri-decoration-control="maximize"]',
    );
    maximize._boundingClientRect = {
      height: 0,
      left: 0,
      top: 0,
      width: 0,
    };
    harness.window.flushResizeObservers();
    rejectFirst(new Error("geometry rejected"));
    await waitForCondition(
      () => geometryCalls >= 2,
      "the disabled state was not retried",
    );
    assert.equal(harness.acknowledgements.at(-1).args.snapGeometry.kind, "disabled");
  });

  it("surfaces degraded status after persistent geometry and disable failures", async () => {
    const fakeTimers = createFakeTimers();
    const harness = createHarness({
      clearTimeoutImpl: fakeTimers.clearTimeoutImpl,
      setTimeoutImpl: fakeTimers.setTimeoutImpl,
      invokeImpl(command, args) {
        if (command !== "plugin:decoration|frontend_geometry") return undefined;
        if (args.snapGeometry.kind === "disabled" && args.snapGeometry.fallback) {
          return undefined;
        }
        return Promise.reject(new Error("geometry unavailable"));
      },
    });
    harness.loadPlatform("windows");
    await loadStylesheet(
      harness,
      harness.window.__TAURI_PLUGIN_DECORATION__.install(config(140)),
    );
    harness.acknowledgements.length = 0;
    harness.window.flushResizeObservers();
    await waitForCalls(harness.invoke, 2);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await waitForCondition(
        () => [...fakeTimers.pending.values()].some((timer) => !timer.canceled),
        "the persistent geometry retry timer was not scheduled",
      );
      fakeTimers.advanceNext();
      await Promise.resolve();
      await Promise.resolve();
    }
    assert.deepEqual(plain(harness.window.__TAURI_PLUGIN_DECORATION__.status()), {
      errorCode: "geometry-delivery",
      phase: "degraded",
    });
  });

  it("uses capped exponential backoff and rate-limits console logging during persistent geometry failure", async () => {
    const delays = [];
    const fakeTimers = createFakeTimers();
    const harness = createHarness({
      clearTimeoutImpl: fakeTimers.clearTimeoutImpl,
      setTimeoutImpl(callback, delay) {
        delays.push(delay);
        return fakeTimers.setTimeoutImpl(callback, delay);
      },
      invokeImpl(command) {
        if (command !== "plugin:decoration|frontend_geometry") return undefined;
        return Promise.reject(new Error("geometry unavailable"));
      },
    });
    harness.loadPlatform("windows");
    await loadStylesheet(
      harness,
      harness.window.__TAURI_PLUGIN_DECORATION__.install(config(141)),
    );
    harness.window.flushResizeObservers();
    await waitForCalls(harness.invoke, 1);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await waitForCondition(
        () => [...fakeTimers.pending.values()].some((timer) => !timer.canceled),
        "the capped-backoff retry timer was not scheduled",
      );
      fakeTimers.advanceNext();
      await Promise.resolve();
      await Promise.resolve();
    }
    assert.ok(
      delays.some((delay) => delay >= 1000),
      "retry delay did not back off beyond 1000ms",
    );
    assert.ok(
      delays.every((delay) => delay <= 12000),
      "retry delay exceeded maximum backoff ceiling",
    );
    assert.ok(
      harness.consoleError.calls.length < delays.length,
      "console error was not rate-limited",
    );
  });

  it("preserves geometry retry backoff across layout churn and resize publications", async (t) => {
    const fakeTimers = createFakeTimers();
    let geometryCalls = 0;
    const harness = createHarness({
      clearTimeoutImpl: fakeTimers.clearTimeoutImpl,
      setTimeoutImpl: fakeTimers.setTimeoutImpl,
      invokeImpl(command) {
        if (command !== "plugin:decoration|frontend_geometry") return undefined;
        geometryCalls += 1;
        return Promise.reject(new Error("geometry unavailable"));
      },
    });

    t.after(() => {
      harness.window.__TAURI_PLUGIN_DECORATION__.cancel("7", "142");
    });

    harness.loadPlatform("windows");
    await loadStylesheet(
      harness,
      harness.window.__TAURI_PLUGIN_DECORATION__.install(config(142)),
    );
    harness.window.flushResizeObservers();
    await waitForCalls(harness.invoke, 2);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const initialCalls = geometryCalls;

    for (let i = 0; i < 10; i += 1) {
      harness.window.flushResizeObservers();
    }
    assert.equal(
      geometryCalls,
      initialCalls,
      "resize publications during failure epoch must not trigger immediate retries",
    );

    const timer = fakeTimers.advanceNext();
    assert.equal(typeof timer.callback, "function");
    await waitForCalls(harness.invoke, 3);
    assert.ok(
      geometryCalls > initialCalls,
      "scheduled retry timer successfully delivered updated geometry",
    );
  });

  it("prioritizes the Snap safety fallback when layout churn crosses the retry threshold in flight", async (t) => {
    const timers = new Map();
    let nextTimerId = 1;
    const setTimeoutImpl = (callback, delay) => {
      const id = nextTimerId++;
      timers.set(id, { callback, canceled: false, delay });
      return id;
    };
    const clearTimeoutImpl = (id) => {
      const timer = timers.get(id);
      if (timer) timer.canceled = true;
    };
    const runNextTimer = async () => {
      const entry = [...timers.entries()].find(([, timer]) => !timer.canceled);
      assert.ok(entry, "expected an active geometry retry timer");
      timers.delete(entry[0]);
      entry[1].callback();
      await Promise.resolve();
      await Promise.resolve();
    };
    const rejectedReports = [];
    let geometryCalls = 0;
    let fallbackCalls = 0;
    const harness = createHarness({
      clearTimeoutImpl,
      setTimeoutImpl,
      invokeImpl(command, args) {
        if (command !== "plugin:decoration|frontend_geometry") return undefined;
        const update = args.snapGeometry;
        if (update.kind === "disabled" && update.fallback) {
          fallbackCalls += 1;
          return undefined;
        }
        geometryCalls += 1;
        const report = new Promise((_, reject) => {
          rejectedReports.push(reject);
        });
        return report;
      },
    });

    t.after(() => {
      harness.window.__TAURI_PLUGIN_DECORATION__.cancel("7", "143");
    });

    harness.loadPlatform("windows");
    await loadStylesheet(
      harness,
      harness.window.__TAURI_PLUGIN_DECORATION__.install(config(143)),
    );
    harness.window.flushResizeObservers();
    await waitForCondition(() => geometryCalls === 1, "initial geometry was not sent");

    for (let attempt = 0; attempt < 3; attempt += 1) {
      rejectedReports.shift()(new Error(`geometry failure ${attempt + 1}`));
      await Promise.resolve();
      await waitForCondition(
        () => [...timers.values()].some((timer) => !timer.canceled),
        "the geometry retry timer was not scheduled",
      );
      await runNextTimer();
      await waitForCondition(
        () => geometryCalls === attempt + 2,
        "the scheduled geometry retry was not sent",
      );
    }

    const maximize = harness.window.document.querySelector(
      '[data-tauri-decoration-control="maximize"]',
    );
    for (let update = 0; update < 5; update += 1) {
      maximize._boundingClientRect = {
        height: 32,
        left: 600 + update,
        top: 0,
        width: 58,
      };
      harness.window.flushResizeObservers();
    }
    rejectedReports.shift()(new Error("threshold geometry failure"));
    await waitForCondition(
      () => fallbackCalls === 1,
      "continuous layout publication suppressed the native safety fallback",
    );

    const fallback = harness.acknowledgements
      .filter(
        ({ command }) => command === "plugin:decoration|frontend_geometry",
      )
      .map(({ args }) => args.snapGeometry)
      .find((update) => update.kind === "disabled" && update.fallback);
    assert.ok(fallback, "the threshold failure must publish a fallback disable state");
    const precedingGeometry = harness.acknowledgements
      .filter(
        ({ command }) => command === "plugin:decoration|frontend_geometry",
      )
      .map(({ args }) => args.snapGeometry)
      .filter((update) => update.kind === "geometry")
      .at(-1);
    assert.ok(precedingGeometry);
    assert.ok(Number(fallback.sequence) > Number(precedingGeometry.sequence));
  });

  it("reconciles a fallback disabled state after transport recovers without new measurements", async () => {
    const fakeTimers = createFakeTimers();
    let transportUp = false;
    let geometryCalls = 0;
    let lastAcceptedSequence = 0;
    const harness = createHarness({
      clearTimeoutImpl: fakeTimers.clearTimeoutImpl,
      setTimeoutImpl: fakeTimers.setTimeoutImpl,
      invokeImpl(command, args) {
        if (command !== "plugin:decoration|frontend_geometry") return undefined;
        geometryCalls += 1;
        if (!transportUp) return Promise.reject(new Error("geometry unavailable"));
        const sequence = Number(args.snapGeometry.sequence);
        const applied = sequence >= lastAcceptedSequence;
        if (applied) lastAcceptedSequence = sequence;
        return { applied };
      },
    });
    harness.loadPlatform("windows");
    await loadStylesheet(
      harness,
      harness.window.__TAURI_PLUGIN_DECORATION__.install(config(145)),
    );
    harness.acknowledgements.length = 0;
    harness.window.flushResizeObservers();
    await waitForCalls(harness.invoke, 2);

    const fireRetry = async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const timer = fakeTimers.advanceNext();
      assert.equal(typeof timer.callback, "function");
      await Promise.resolve();
      await Promise.resolve();
    };
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await fireRetry();
    }
    transportUp = true;
    const callsBeforeRecovery = geometryCalls;
    await fireRetry();
    await waitForCondition(
      () => geometryCalls > callsBeforeRecovery,
      "the degraded reconciler did not retry after transport recovery",
    );
    const update = harness.acknowledgements.at(-1).args.snapGeometry;
    assert.equal(update.kind, "disabled");
    assert.equal(update.fallback, true);
    assert.deepEqual(plain(harness.window.__TAURI_PLUGIN_DECORATION__.status()), {
      errorCode: "geometry-delivery",
      phase: "degraded",
    });
    await fireRetry();
    await waitForCondition(
      () => harness.window.__TAURI_PLUGIN_DECORATION__.status().phase === "active",
      "the post-fallback probe did not restore Snap geometry",
    );
    const recovered = harness.acknowledgements.at(-1).args.snapGeometry;
    assert.equal(recovered.kind, "geometry");
    assert.ok(Number(recovered.sequence) > Number(update.sequence));
  });

  it("disposes the previous geometry observer during same-document reinjection", async () => {
    const harness = createHarness();
    harness.loadPlatform("windows");
    await loadStylesheet(
      harness,
      harness.window.__TAURI_PLUGIN_DECORATION__.install(config(40)),
    );
    await loadStylesheet(
      harness,
      harness.window.__TAURI_PLUGIN_DECORATION__.install(config(41)),
    );

    harness.acknowledgements.length = 0;
    harness.window.flushResizeObservers();
    await waitForCondition(
      () =>
        harness.acknowledgements.filter(
          ({ command }) =>
            command === "plugin:decoration|frontend_geometry",
        ).length === 1,
      "the current geometry observer did not report exactly once",
    );
  });

  it("delivers the latest geometry after an in-flight IPC update completes", async () => {
    let releaseFirstUpdate;
    const firstUpdate = new Promise((resolve) => {
      releaseFirstUpdate = resolve;
    });
    let geometryCalls = 0;
    const harness = createHarness({
      invokeImpl(command) {
        if (command !== "plugin:decoration|frontend_geometry") return undefined;
        geometryCalls += 1;
        return geometryCalls === 1 ? firstUpdate : undefined;
      },
    });
    harness.loadPlatform("windows");
    await loadStylesheet(
      harness,
      harness.window.__TAURI_PLUGIN_DECORATION__.install(config(43)),
    );

    harness.acknowledgements.length = 0;
    harness.window.flushResizeObservers();
    await waitForCondition(
      () => geometryCalls === 1,
      "the first geometry update was not sent",
    );
    const maximize = harness.window.document.querySelector(
      '[data-tauri-decoration-control="maximize"]',
    );
    maximize._boundingClientRect = {
      height: 32,
      left: 620,
      top: 0,
      width: 58,
    };
    harness.window.flushResizeObservers();
    assert.equal(geometryCalls, 1);

    releaseFirstUpdate();
    await waitForCondition(
      () => geometryCalls === 2,
      "the trailing geometry update was not sent",
    );
    const updates = harness.acknowledgements.filter(
      ({ command }) => command === "plugin:decoration|frontend_geometry",
    );
    assert.equal(updates.at(-1).args.snapGeometry.geometry.x, 620);
  });

  it("converges resize churn against an exact-next geometry backend", async () => {
    let releaseFirst;
    const firstUpdate = new Promise((resolve) => {
      releaseFirst = (result) => {
        cursor = 2;
        resolve(result);
      };
    });
    let cursor = 0;
    const sequences = [];
    const harness = createHarness({
      invokeImpl(command, args) {
        if (command !== "plugin:decoration|frontend_geometry") return undefined;
        const sequence = Number(args.snapGeometry.sequence);
        sequences.push(sequence);
        if (sequences.length === 1) return firstUpdate;
        if (sequence !== cursor + 1) {
          return { applied: false, cursor: String(cursor) };
        }
        cursor = sequence;
        return { applied: true, cursor: String(cursor) };
      },
    });
    harness.loadPlatform("windows");
    await loadStylesheet(
      harness,
      harness.window.__TAURI_PLUGIN_DECORATION__.install(config(44)),
    );
    harness.acknowledgements.length = 0;
    harness.window.flushResizeObservers();
    await waitForCondition(() => sequences.length === 1, "initial geometry was not sent");

    const maximize = harness.window.document.querySelector(
      '[data-tauri-decoration-control="maximize"]',
    );
    for (let update = 0; update < 12; update += 1) {
      maximize._boundingClientRect = {
        height: 32,
        left: 600 + update,
        top: 0,
        width: 58,
      };
      harness.window.flushResizeObservers();
    }
    releaseFirst({ applied: true, cursor: "2" });
    await waitForCondition(
      () => cursor >= 3,
      "the exact-next backend did not converge",
    );

    assert.ok(sequences.length <= 3, `resize churn was not coalesced: ${sequences}`);
    assert.equal(cursor, sequences.at(-1));
    assert.equal(harness.acknowledgements.at(-1).args.snapGeometry.geometry.x, 611);
  });

  it("coalesces resize bursts to one in-flight and one trailing geometry update", async () => {
    const harness = createHarness();
    harness.loadPlatform("windows");
    await loadStylesheet(
      harness,
      harness.window.__TAURI_PLUGIN_DECORATION__.install(config(42)),
    );

    harness.acknowledgements.length = 0;
    for (let index = 0; index < 20; index += 1) {
      harness.window.flushResizeObservers();
    }
    await waitForCondition(
      () =>
        harness.acknowledgements.some(
          ({ command }) => command === "plugin:decoration|frontend_geometry",
        ),
      "the geometry burst was not delivered",
    );
    await Promise.resolve();

    const geometryUpdates = harness.acknowledgements.filter(
      ({ command }) => command === "plugin:decoration|frontend_geometry",
    ).length;
    assert.ok(
      geometryUpdates >= 1 && geometryUpdates <= 2,
      `expected at most one in-flight and one trailing update, got ${geometryUpdates}`,
    );
  });

  it("keeps two webview documents fully isolated", async () => {
    const first = createHarness();
    const second = createHarness();
    first.loadPlatform("windows");
    second.loadPlatform("windows");

    await Promise.all([
      loadStylesheet(
        first,
        first.window.__TAURI_PLUGIN_DECORATION__.install(config(50)),
      ),
      loadStylesheet(
        second,
        second.window.__TAURI_PLUGIN_DECORATION__.install(config(50)),
      ),
    ]);
    first.window.__TAURI_PLUGIN_DECORATION__.dispatch(
      "7",
      "50",
      "snap-click",
      null,
    );
    await waitForCondition(
      () =>
        first.acknowledgements.some(
          ({ command }) => command === "plugin:decoration|window_control",
        ),
      "the first webview did not route its control action",
    );

    assert.equal(
      first.acknowledgements.filter(
        ({ command }) => command === "plugin:decoration|window_control",
      ).length,
      1,
    );
    assert.equal(
      second.acknowledgements.filter(
        ({ command }) => command === "plugin:decoration|window_control",
      ).length,
      0,
    );
    assert.notEqual(first.window.document, second.window.document);
  });

  it("applies macOS traffic-light clearance only for the exact active document", async () => {
    const harness = createHarness();
    const installation = harness.window.__TAURI_PLUGIN_DECORATION__.install(
      config(55, "macos"),
    );
    await loadStylesheet(harness, installation);

    const runtime = harness.window.__TAURI_PLUGIN_DECORATION__;
    const style = harness.window.document.documentElement.style;
    const normalState = { fullscreen: false, clearance: 72 };
    assert.equal(
      runtime.dispatch("7", "54", "macos-titlebar-state", normalState),
      false,
    );
    for (const invalid of [
      null,
      { fullscreen: "false", clearance: 72 },
      { fullscreen: false, clearance: -1 },
      { fullscreen: false, clearance: Number.NaN },
      { fullscreen: false, clearance: Number.POSITIVE_INFINITY },
      { fullscreen: false, clearance: "72" },
    ]) {
      assert.equal(
        runtime.dispatch("7", "55", "macos-titlebar-state", invalid),
        false,
      );
    }
    assert.equal(
      runtime.dispatch("7", "55", "macos-titlebar-state", normalState),
      true,
    );
    assert.equal(
      style.getPropertyValue("--tauri-plugin-decoration-left-clearance"),
      "72px",
    );
  });

  it("collapses macOS titlebar clearance while the native window is fullscreen", async () => {
    const harness = createHarness();
    await loadStylesheet(
      harness,
      harness.window.__TAURI_PLUGIN_DECORATION__.install(config(56, "macos")),
    );

    const runtime = harness.window.__TAURI_PLUGIN_DECORATION__;
    const root = harness.window.document.querySelector(
      "[data-tauri-plugin-decoration-root]",
    );
    const style = harness.window.document.documentElement.style;
    assert.equal(
      runtime.dispatch("7", "56", "macos-titlebar-state", {
        fullscreen: false,
        clearance: 72,
      }),
      true,
    );
    assert.equal(
      runtime.dispatch("7", "56", "macos-titlebar-state", {
        fullscreen: true,
        clearance: 0,
      }),
      true,
    );
    assert.equal(root.getAttribute("data-tauri-decoration-fullscreen"), "");
    assert.equal(
      style.getPropertyValue("--tauri-plugin-decoration-left-clearance"),
      "0px",
    );
    assert.equal(
      runtime.dispatch("7", "56", "macos-titlebar-state", {
        fullscreen: false,
        clearance: 72,
      }),
      true,
    );
    assert.equal(root.hasAttribute("data-tauri-decoration-fullscreen"), false);
    assert.equal(
      style.getPropertyValue("--tauri-plugin-decoration-left-clearance"),
      "72px",
    );
  });

  it("renders atomic native macOS titlebar state across fullscreen exit", async () => {
    const isFullscreen = spy(async () => true);
    const harness = createHarness({ isFullscreen });
    await loadStylesheet(
      harness,
      harness.window.__TAURI_PLUGIN_DECORATION__.install(config(57, "macos")),
    );

    const runtime = harness.window.__TAURI_PLUGIN_DECORATION__;
    const root = harness.window.document.querySelector(
      "[data-tauri-plugin-decoration-root]",
    );
    const style = harness.window.document.documentElement.style;
    assert.equal(isFullscreen.calls.length, 0);
    assert.equal(
      runtime.dispatch("7", "57", "macos-titlebar-state", {
        fullscreen: true,
        clearance: 0,
      }),
      true,
    );
    assert.equal(root.getAttribute("data-tauri-decoration-fullscreen"), "");
    assert.equal(
      style.getPropertyValue("--tauri-plugin-decoration-left-clearance"),
      "0px",
    );

    assert.equal(
      runtime.dispatch("7", "57", "macos-titlebar-state", {
        fullscreen: false,
        clearance: 72,
      }),
      true,
    );
    assert.equal(root.getAttribute("data-tauri-decoration-fullscreen"), null);
    assert.equal(
      style.getPropertyValue("--tauri-plugin-decoration-left-clearance"),
      "72px",
    );
  });

  it("accepts macOS titlebar state only for the current reinjection target", async () => {
    const harness = createHarness();
    await loadStylesheet(
      harness,
      harness.window.__TAURI_PLUGIN_DECORATION__.install(config(57, "macos")),
    );
    await loadStylesheet(
      harness,
      harness.window.__TAURI_PLUGIN_DECORATION__.install(config(58, "macos")),
    );

    const runtime = harness.window.__TAURI_PLUGIN_DECORATION__;
    assert.equal(
      runtime.dispatch("7", "57", "macos-titlebar-state", {
        fullscreen: false,
        clearance: 72,
      }),
      false,
    );
    assert.equal(
      runtime.dispatch("7", "58", "macos-titlebar-state", {
        fullscreen: false,
        clearance: 72,
      }),
      true,
    );
  });

  it("does not query asynchronous JavaScript fullscreen state on macOS resize", async () => {
    const isFullscreen = spy(async () => false);
    const harness = createHarness({ isFullscreen });
    await loadStylesheet(
      harness,
      harness.window.__TAURI_PLUGIN_DECORATION__.install(config(59, "macos")),
    );

    isFullscreen.mockClear();
    harness.window.dispatchEvent(new harness.window.Event("resize"));
    harness.window.dispatchEvent(new harness.window.Event("resize"));
    harness.window.dispatchEvent(new harness.window.Event("resize"));
    await Promise.resolve();
    assert.equal(isFullscreen.calls.length, 0);
  });

  it("keeps the previous macOS titlebar state when a malformed event arrives", async () => {
    const harness = createHarness();
    await loadStylesheet(
      harness,
      harness.window.__TAURI_PLUGIN_DECORATION__.install(config(60, "macos")),
    );

    const runtime = harness.window.__TAURI_PLUGIN_DECORATION__;
    assert.equal(
      runtime.dispatch("7", "60", "macos-titlebar-state", {
        fullscreen: false,
        clearance: 72,
      }),
      true,
    );
    assert.equal(
      runtime.dispatch("7", "60", "macos-titlebar-state", {
        fullscreen: true,
        clearance: -1,
      }),
      false,
    );
    assert.equal(
      harness.window.document.documentElement.style.getPropertyValue(
        "--tauri-plugin-decoration-left-clearance",
      ),
      "72px",
    );
  });

  it("publishes both Linux clearances for left- and right-side GTK layouts", async () => {
    const harness = createHarness();
    harness.loadPlatform("linux");
    const options = config(56, "linux");
    options.layout = {
      left: ["close", "minimize"],
      right: ["maximize"],
    };
    await loadStylesheet(
      harness,
      harness.window.__TAURI_PLUGIN_DECORATION__.install(options),
    );

    const style = harness.window.document.documentElement.style;
    assert.equal(
      style.getPropertyValue("--tauri-plugin-decoration-left-clearance"),
      "86px",
    );
    assert.equal(
      style.getPropertyValue("--tauri-plugin-decoration-right-clearance"),
      "48px",
    );
  });

  it("keeps a valid empty Linux layout active without ResizeObserver", async () => {
    const harness = createHarness();
    harness.window.ResizeObserver = undefined;
    harness.loadPlatform("linux");
    const options = config(57, "linux");
    options.controls = [];
    options.layout = { left: [], right: [] };
    await loadStylesheet(
      harness,
      harness.window.__TAURI_PLUGIN_DECORATION__.install(options),
    );

    const style = harness.window.document.documentElement.style;
    assert.equal(
      style.getPropertyValue("--tauri-plugin-decoration-left-clearance"),
      "0px",
    );
    assert.equal(
      style.getPropertyValue("--tauri-plugin-decoration-right-clearance"),
      "0px",
    );
  });

  it("uses inert Linux images with explicit names and button semantics", async () => {
    const harness = createHarness();
    harness.loadPlatform("linux");
    const installation = harness.window.__TAURI_PLUGIN_DECORATION__.install(
      config(60, "linux"),
    );
    await loadStylesheet(harness, installation);

    const buttons = harness.window.document.querySelectorAll("button");
    assert.deepEqual(
      buttons.map((button) => button.getAttribute("aria-label")),
      ["Minimize window", "Maximize window size", "Close window"],
    );
    for (const button of buttons) {
      assert.equal(button.getAttribute("type"), "button");
      const image = button.querySelector("img");
      assert.equal(image.getAttribute("alt"), "");
      assert.equal(image.getAttribute("aria-hidden"), "true");
      assert.match(image.src, /^data:image\/png;base64,/);
    }
  });

  it("falls back per Linux control when a theme image cannot be decoded", async () => {
    const harness = createHarness();
    harness.loadPlatform("linux");
    await loadStylesheet(
      harness,
      harness.window.__TAURI_PLUGIN_DECORATION__.install(config(60, "linux")),
    );

    const close = harness.window.document.querySelector(
      '[data-tauri-decoration-control="close"]',
    );
    const image = close.querySelector("img");
    image.dispatchEvent(new harness.window.Event("error"));

    assert.equal(image.getAttribute("src"), null);
    assert.equal(
      close.getAttribute("data-tauri-decoration-icon-fallback"),
      "",
    );
  });

  it("delegates Linux edge resizing to Tauri's undecorated runtime", async () => {
    const harness = createHarness();
    harness.loadPlatform("linux");
    await loadStylesheet(
      harness,
      harness.window.__TAURI_PLUGIN_DECORATION__.install(config(61, "linux")),
    );

    const handles = harness.window.document.querySelectorAll(
      "[data-tauri-decoration-resize]",
    );
    assert.equal(handles.length, 0);
  });

  it("reports Linux action failures and allows a later retry", async () => {
    let denied = true;
    const harness = createHarness({
      invokeImpl: async (command, args) => {
        if (
          command === "plugin:decoration|window_control" &&
          args.action === "minimize" &&
          denied
        ) {
          denied = false;
          throw new Error("denied");
        }
      },
    });
    harness.loadPlatform("linux");
    await loadStylesheet(
      harness,
      harness.window.__TAURI_PLUGIN_DECORATION__.install(config(62, "linux")),
    );

    const minimize = harness.window.document.querySelector(
      '[data-tauri-decoration-control="minimize"]',
    );
    const close = harness.window.document.querySelector(
      '[data-tauri-decoration-control="close"]',
    );
    minimize.dispatchEvent(new harness.window.Event("click"));
    await waitForCalls(harness.consoleError, 1);
    assert.equal(minimize.getAttribute("disabled"), null);
    assert.equal(
      harness.invoke.calls.some(
        ([command]) => command === "plugin:decoration|frontend_fallback",
      ),
      false,
    );
    assert.match(
      harness.consoleError.calls[0][0],
      /Linux minimize action failed/,
    );
    assert.ok(
      harness.window.document.querySelector(
        "[data-tauri-plugin-decoration-root]",
      ),
    );
    minimize.dispatchEvent(new harness.window.Event("click"));
    await waitForCondition(
      () =>
        harness.acknowledgements.filter(
          ({ command, args }) =>
            command === "plugin:decoration|window_control" &&
            args.action === "minimize",
        ).length === 2,
      "a second Linux minimize request was not sent",
    );
    close.dispatchEvent(new harness.window.Event("click"));
    await waitForCondition(
      () =>
        harness.acknowledgements.some(
          ({ command, args }) =>
            command === "plugin:decoration|window_control" &&
            args.action === "close",
        ),
      "the Linux close request was not sent",
    );
  });

  it("hides Linux controls and clearances throughout fullscreen", async () => {
    const isFullscreen = spy(async () => true);
    const harness = createHarness({ isFullscreen });
    harness.loadPlatform("linux");
    const options = config(63, "linux");
    options.layout = { left: ["close"], right: ["minimize", "maximize"] };
    options.fullscreen = true;
    await loadStylesheet(
      harness,
      harness.window.__TAURI_PLUGIN_DECORATION__.install(options),
    );

    const root = harness.window.document.querySelector(
      "[data-tauri-plugin-decoration-root]",
    );
    const style = harness.window.document.documentElement.style;
    assert.equal(root.getAttribute("data-tauri-decoration-fullscreen"), "");
    assert.equal(
      style.getPropertyValue("--tauri-plugin-decoration-left-clearance"),
      "0px",
    );
    assert.equal(
      style.getPropertyValue("--tauri-plugin-decoration-right-clearance"),
      "0px",
    );

    harness.window.__TAURI_PLUGIN_DECORATION__.dispatch(
      "7",
      "63",
      "window-state",
      { maximized: false, fullscreen: false, revision: 1 },
    );
    assert.equal(root.getAttribute("data-tauri-decoration-fullscreen"), null);
    assert.equal(
      style.getPropertyValue("--tauri-plugin-decoration-left-clearance"),
      "48px",
    );
    assert.equal(
      style.getPropertyValue("--tauri-plugin-decoration-right-clearance"),
      "86px",
    );
    assert.equal(isFullscreen.calls.length, 0);
  });

  it("keeps GTK controls as an activation snapshot across focus changes", async () => {
    const harness = createHarness();
    harness.loadPlatform("linux");
    await loadStylesheet(
      harness,
      harness.window.__TAURI_PLUGIN_DECORATION__.install(config(64, "linux")),
    );

    const original = harness.window.document.querySelector(
      '[data-tauri-decoration-control="close"]',
    );
    harness.window.dispatchEvent(new harness.window.Event("focus"));
    harness.window.dispatchEvent(new harness.window.Event("blur"));
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(
      harness.invoke.calls.some(
        ([command]) => command === "plugin:decoration|linux_options",
      ),
      false,
    );
    assert.equal(
      harness.window.document.querySelector(
        '[data-tauri-decoration-control="close"]',
      ),
      original,
    );
  });

});
