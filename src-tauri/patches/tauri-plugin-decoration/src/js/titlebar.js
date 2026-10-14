(() => {
  "use strict";

  // ALwith U grants this plugin only to the primary window.
  if (window.__TAURI_INTERNALS__.metadata.currentWindow.label !== "main") return;

  const GLOBAL_NAME = "__TAURI_PLUGIN_DECORATION__";
  const DOCUMENT_LEASE_SLOT = "__TAURI_PLUGIN_DECORATION_DOCUMENT_LEASE__";
  const VERSION = 1;
  const STYLESHEET_SELECTOR =
    'link[data-tauri-plugin-decoration-stylesheet="v1"]';
  const READY_PROPERTY = "--tauri-plugin-decoration-ready";
  const ACK_COMMAND = "plugin:decoration|frontend_ack";
  const DOCUMENT_BOOT_COMMAND = "plugin:decoration|frontend_document_boot";
  const DOCUMENT_READY_COMMAND = "plugin:decoration|frontend_document_ready";
  const GEOMETRY_COMMAND = "plugin:decoration|frontend_geometry";
  const WINDOW_CONTROL_COMMAND = "plugin:decoration|window_control";
  const STYLESHEET_TIMEOUT_MS = 4000;
  const DOCUMENT_RETRY_DELAYS_MS = [32, 128, 512, 1024];
  const CLOSED_EVENTS = new Set([
    "snap-mouseenter",
    "snap-mouseleave",
    "snap-mousedown",
    "snap-mouseup",
    "snap-click",
    "macos-titlebar-state",
    "window-state",
  ]);

  const isTrustedDocument =
    window.top === window &&
    (window.location?.protocol === "tauri:" ||
      window.location?.protocol === "asset:" ||
      ((window.location?.protocol === "http:" ||
        window.location?.protocol === "https:") &&
        ["localhost", "127.0.0.1", "::1", "[::1]", "tauri.localhost"].includes(
          window.location?.hostname,
        )));
  if (!isTrustedDocument) return;

  const existing = window[GLOBAL_NAME];
  if (existing?.version === VERSION) return;

  class InstallationFailure extends Error {
    constructor(code) {
      super(code);
      this.code = code;
    }
  }

  const platforms = new Map();
  const documentNonce = Array.from(crypto.getRandomValues(new Uint32Array(4)),
    (value) => value.toString(16).padStart(8, "0"),
  ).join("");
  let current = null;
  let lastStatus = {
    errorCode: null,
    phase: "idle",
  };

  const isDecimalToken = (value) =>
    typeof value === "string" && /^[1-9][0-9]*$/.test(value);

  const isCurrent = (installation) => current === installation && !installation.disposed;

  const updateStatus = (installation, phase, errorCode = null) => {
    lastStatus = {
      errorCode,
      phase,
    };
  };

  const runDisposers = (installation) => {
    const disposers = installation.disposers.splice(0).reverse();
    for (const dispose of disposers) dispose();
  };

  const removeOwnedDom = (installation) => {
    installation.root?.remove();
    installation.root = null;
    if (installation.stylesheet?.created) {
      installation.stylesheet.element.remove();
    }
    installation.stylesheet = null;
  };

  const dispose = (installation) => {
    if (installation.disposed) return;
    installation.disposed = true;
    runDisposers(installation);
    removeOwnedDom(installation);
    if (current === installation) current = null;
    updateStatus(installation, "cancelled");
  };

  const sentinelReady = () =>
    window
      .getComputedStyle(document.documentElement)
      .getPropertyValue(READY_PROPERTY)
      .trim() === "ready";

  const waitForStylesheet = async (installation) => {
    const internals = window.__TAURI_INTERNALS__;
    if (
      !internals ||
      typeof internals.convertFileSrc !== "function" ||
      typeof internals.invoke !== "function"
    ) {
      throw new InstallationFailure("tauri-internals-unavailable");
    }

    const href = internals.convertFileSrc(
      "controls.css",
      "tauri-plugin-decoration",
    );
    let link = document.querySelector(STYLESHEET_SELECTOR);
    const created = link === null;
    if (created) {
      link = document.createElement("link");
      link.setAttribute("rel", "stylesheet");
      link.setAttribute("href", href);
      link.setAttribute("data-tauri-plugin-decoration-stylesheet", "v1");
      link.setAttribute("data-tauri-plugin-decoration-owned", "stylesheet");
    } else if (link.getAttribute("href") !== href) {
      throw new InstallationFailure("stylesheet-conflict");
    }
    installation.stylesheet = { created, element: link };
    if (!created && sentinelReady()) return;

    await new Promise((resolve, reject) => {
      let settled = false;
      let timeoutId = null;
      const cleanup = () => {
        if (timeoutId !== null) window.clearTimeout(timeoutId);
        link.removeEventListener("load", onLoad);
        link.removeEventListener("error", onError);
      };
      const finish = (callback) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback();
      };
      const onLoad = () => {
        if (!isCurrent(installation)) {
          finish(() => reject(new InstallationFailure("stale")));
        } else if (!sentinelReady()) {
          finish(() => reject(new InstallationFailure("stylesheet-sentinel")));
        } else {
          finish(resolve);
        }
      };
      const onError = () =>
        finish(() => reject(new InstallationFailure("stylesheet-load")));
      const onTimeout = () =>
        finish(() => reject(new InstallationFailure("stylesheet-timeout")));
      installation.disposers.push(() =>
        finish(() => reject(new InstallationFailure("stale"))),
      );
      link.addEventListener("load", onLoad, { once: true });
      link.addEventListener("error", onError, { once: true });
      timeoutId = window.setTimeout(onTimeout, STYLESHEET_TIMEOUT_MS);
      if (created) document.head.appendChild(link);
    });
  };

  const createRoot = (installation) => {
    const root = document.createElement("div");
    root.setAttribute("data-tauri-plugin-decoration-root", "");
    root.setAttribute("data-tauri-plugin-decoration-owned", "root");

    document.body.prepend(root);
    installation.root = root;
    return root;
  };

  const setOwnedProperty = (installation, property, value) => {
    const style = document.documentElement.style;
    if (!installation.ownedProperties.has(property)) {
      const hadInlineValue = Array.from(
        { length: style.length },
        (_, index) => style.item(index),
      ).includes(property);
      const previousValue = style.getPropertyValue(property);
      const previousPriority = style.getPropertyPriority(property);
      installation.ownedProperties.set(property, {
        hadInlineValue,
        previousPriority,
        previousValue,
      });
      installation.disposers.push(() => {
        const previous = installation.ownedProperties.get(property);
        if (!previous) return;
        if (previous.hadInlineValue) {
          style.setProperty(
            property,
            previous.previousValue,
            previous.previousPriority,
          );
        } else {
          style.removeProperty(property);
        }
      });
    }
    style.setProperty(property, value);
  };

  const setClearance = (installation, side, value) => {
    if (
      (side !== "left" && side !== "right") ||
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0
    ) {
      return false;
    }
    const property = `--tauri-plugin-decoration-${side}-clearance`;
    setOwnedProperty(installation, property, `${value}px`);
    return true;
  };

  const targetPayload = (installation) => ({
    windowGeneration: installation.config.windowGeneration,
    documentToken: installation.config.documentToken,
  });

  const acknowledge = (
    installation,
    ok,
    errorCode = null,
    snapGeometry = null,
  ) =>
    window.__TAURI_INTERNALS__.invoke(ACK_COMMAND, {
      ...targetPayload(installation),
      ok,
      errorCode,
      snapGeometry,
    });

  const invokeWindowControl = (installation, action) =>
    window.__TAURI_INTERNALS__.invoke(WINDOW_CONTROL_COMMAND, {
      ...targetPayload(installation),
      action,
    });

  const markGeometryDegraded = (installation) => {
    if (!isCurrent(installation)) return;
    updateStatus(installation, "degraded", "geometry-delivery");
  };

  const reportGeometry = async (installation, snapGeometry) => {
    if (!isCurrent(installation)) return "cancelled";
    if (!installation.active) return "inactive";
    if (!snapGeometry) return "malformed";
    const receipt = await window.__TAURI_INTERNALS__.invoke(GEOMETRY_COMMAND, {
      ...targetPayload(installation),
      snapGeometry,
    });
    if (!isCurrent(installation)) return "cancelled";
    if (receipt?.applied !== true) {
      return { cursor: receipt?.cursor, status: "stale" };
    }
    if (snapGeometry.kind === "geometry" || snapGeometry.fallback === false) {
      updateStatus(installation, "active");
    }
    return { cursor: receipt.cursor, status: "applied" };
  };

  const fail = async (installation, errorCode) => {
    if (!isCurrent(installation)) return;
    installation.disposed = true;
    current = null;
    runDisposers(installation);
    removeOwnedDom(installation);
    updateStatus(installation, "failed", errorCode);
    try {
      await acknowledge(installation, false, errorCode);
    } catch {
      // Failure reporting may fail; the application must still request explicit
      // native restoration before revealing a failed installation.
    }
  };

  const prepare = async (installation) => {
    try {
      if (!document.head || !document.body) {
        throw new InstallationFailure("document-unavailable");
      }
      await waitForStylesheet(installation);
      if (!isCurrent(installation)) return;

      const root = createRoot(installation);
      const platformFactory = platforms.get(installation.config.platform);
      if (!platformFactory) throw new InstallationFailure("platform-unavailable");
      installation.platform = await platformFactory({
        addDisposer: (disposer) => installation.disposers.push(disposer),
        config: installation.config,
        document,
        isCurrent: () => isCurrent(installation),
        markGeometryDegraded: () => markGeometryDegraded(installation),
        reportGeometry: (geometry) => reportGeometry(installation, geometry),
        root,
        setClearance: (side, value) => setClearance(installation, side, value),
        setOwnedProperty: (property, value) =>
          setOwnedProperty(installation, property, value),
        window,
        windowControl: (action) => invokeWindowControl(installation, action),
      });
      if (!isCurrent(installation)) return;

      root.setAttribute("data-tauri-plugin-decoration-prepared", "");
      try {
        const snapGeometry =
          typeof installation.platform?.snapGeometry === "function"
            ? installation.platform.snapGeometry()
            : null;
        await acknowledge(installation, true, null, snapGeometry);
      } catch {
        throw new InstallationFailure("native-activation");
      }
      if (!isCurrent(installation)) return;

      root.removeAttribute("data-tauri-plugin-decoration-prepared");
      root.setAttribute("data-tauri-plugin-decoration-active", "");
      installation.active = true;
      installation.platform?.activate?.();
      updateStatus(installation, "active");
    } catch (error) {
      const code =
        error instanceof InstallationFailure ? error.code : "platform-install";
      if (code !== "stale") await fail(installation, code);
    }
  };

  const install = (config) => {
    if (
      !config ||
      !isDecimalToken(config.windowGeneration) ||
      !isDecimalToken(config.documentToken) ||
      typeof config.platform !== "string"
    ) {
      return false;
    }

    if (current) {
      if (
        config.windowGeneration === current.config.windowGeneration &&
        config.documentToken === current.config.documentToken
      ) {
        return true;
      }
      dispose(current);
    }

    const installation = {
      config,
      active: false,
      disposed: false,
      disposers: [],
      ownedProperties: new Map(),
      platform: null,
      root: null,
      stylesheet: null,
    };
    current = installation;
    updateStatus(installation, "preparing");
    void prepare(installation);
    return true;
  };

  let documentChallenge = null;
  let documentLease = null;
  let documentBootRetryTimer = null;
  let documentBootRetryAttempt = 0;
  let documentBootInFlight = null;
  let documentBootRevision = 0;
  let documentReadyRetryTimer = null;
  let documentReadyRetryAttempt = 0;
  let documentReadyInFlight = null;
  let documentReadyRevision = 0;
  let documentLifecycleEnded = false;
  let documentLifecycleSuspended = false;

  const currentDocumentLease = () => {
    return documentLease;
  };

  const clearDocumentBootRetry = () => {
    if (documentBootRetryTimer !== null) {
      window.clearTimeout(documentBootRetryTimer);
      documentBootRetryTimer = null;
    }
  };

  const clearDocumentReadyRetry = () => {
    if (documentReadyRetryTimer !== null) {
      window.clearTimeout(documentReadyRetryTimer);
      documentReadyRetryTimer = null;
    }
  };

  const cancelDocumentRetries = (event) => {
    documentBootRevision += 1;
    documentReadyRevision += 1;
    clearDocumentBootRetry();
    clearDocumentReadyRetry();
    if (event?.persisted) {
      documentLifecycleSuspended = true;
      documentBootAnnounced = false;
      documentReadyAnnounced = false;
      documentBootInFlight = null;
      documentReadyInFlight = null;
      return;
    }
    documentLifecycleEnded = true;
  };

  const scheduleDocumentBootRetry = () => {
    if (
      documentLifecycleEnded ||
      documentLifecycleSuspended ||
      documentBootRetryTimer !== null ||
      documentBootRetryAttempt >= DOCUMENT_RETRY_DELAYS_MS.length
    ) {
      return;
    }
    const delay = DOCUMENT_RETRY_DELAYS_MS[documentBootRetryAttempt];
    documentBootRetryAttempt += 1;
    documentBootRetryTimer = window.setTimeout(() => {
      documentBootRetryTimer = null;
      announceDocumentBoot();
    }, delay);
  };

  const scheduleDocumentReadyRetry = () => {
    if (
      documentLifecycleEnded ||
      documentLifecycleSuspended ||
      documentReadyRetryTimer !== null ||
      documentReadyRetryAttempt >= DOCUMENT_RETRY_DELAYS_MS.length
    ) {
      return;
    }
    const delay = DOCUMENT_RETRY_DELAYS_MS[documentReadyRetryAttempt];
    documentReadyRetryAttempt += 1;
    documentReadyRetryTimer = window.setTimeout(() => {
      documentReadyRetryTimer = null;
      announceDocumentReady();
    }, delay);
  };

  const installForDocument = (nonce, challenge, config) =>
    nonce === documentNonce &&
    challenge === documentChallenge?.challenge &&
    config?.windowGeneration === documentChallenge?.windowGeneration &&
    config?.documentToken === documentChallenge?.documentToken &&
    install(config);

  let documentReadyAnnounced = false;
  let documentBootAnnounced = false;
  const settleDocumentReady = (revision, receipt, failed = false) => {
    if (documentReadyInFlight !== revision) return;
    documentReadyInFlight = null;
    if (documentLifecycleEnded || documentLifecycleSuspended) return;
    if (revision !== documentReadyRevision) {
      announceDocumentReady();
      return;
    }
    if (failed || receipt?.status === "retryCurrentBinding") {
      documentReadyAnnounced = false;
      scheduleDocumentReadyRetry();
      return;
    }
    documentReadyAnnounced = true;
    documentReadyRetryAttempt = 0;
    clearDocumentReadyRetry();
  };
  const announceDocumentReady = () => {
    if (
      documentLifecycleEnded ||
      documentLifecycleSuspended ||
      documentReadyAnnounced ||
      documentReadyInFlight !== null ||
      !documentBootAnnounced ||
      !documentChallenge ||
      document.readyState === "loading" ||
      currentDocumentLease() !== documentChallenge.documentLease
    ) {
      return;
    }
    const invoke = window.__TAURI_INTERNALS__?.invoke;
    if (typeof invoke !== "function") return;
    const revision = documentReadyRevision;
    documentReadyInFlight = revision;
    void invoke(DOCUMENT_READY_COMMAND, {
      ...documentChallenge,
      documentNonce,
    })
      .then((receipt) => settleDocumentReady(revision, receipt))
      .catch(() => settleDocumentReady(revision, null, true));
  };

  const challengeDocument = (
    windowGeneration,
    documentToken,
    challenge,
    documentLease,
  ) => {
    if (
      !isDecimalToken(windowGeneration) ||
      !isDecimalToken(documentToken) ||
      !isDecimalToken(challenge) ||
      !isDecimalToken(documentLease) ||
      documentLease !== currentDocumentLease()
    ) {
      return false;
    }
    if (
      documentChallenge?.windowGeneration === windowGeneration &&
      documentChallenge.documentToken === documentToken &&
      documentChallenge.challenge === challenge &&
      documentChallenge.documentLease === documentLease
    ) {
      announceDocumentReady();
      return true;
    }
    documentChallenge = {
      windowGeneration,
      documentToken,
      challenge,
      documentLease,
    };
    documentReadyRevision += 1;
    documentReadyAnnounced = false;
    documentReadyRetryAttempt = 0;
    clearDocumentReadyRetry();
    announceDocumentReady();
    return true;
  };

  const announceDocumentBoot = () => {
    if (
      documentLifecycleEnded ||
      documentLifecycleSuspended ||
      documentLease === null ||
      documentBootAnnounced ||
      documentBootInFlight !== null
    ) return;
    const invoke = window.__TAURI_INTERNALS__?.invoke;
    if (typeof invoke !== "function") return;
    const revision = documentBootRevision;
    documentBootInFlight = revision;
    void invoke(DOCUMENT_BOOT_COMMAND, { documentNonce, documentLease })
      .then((challenge) => {
        if (documentBootInFlight !== revision) return;
        documentBootInFlight = null;
        if (documentLifecycleEnded || documentLifecycleSuspended) return;
        if (revision !== documentBootRevision) {
          announceDocumentBoot();
          return;
        }
        const status = challenge?.status;
        if (status === "retryCurrentBinding") {
          documentBootAnnounced = false;
          scheduleDocumentBootRetry();
          return;
        }
        if (status === "stale") {
          documentBootAnnounced = true;
          documentBootRetryAttempt = 0;
          clearDocumentBootRetry();
          return;
        }
        if (status === "accepted") {
          const acceptedChallenge = challenge.challenge;
          if (!isDecimalToken(acceptedChallenge?.documentLease)) {
            documentBootAnnounced = false;
            scheduleDocumentBootRetry();
            return;
          }
          documentLease = acceptedChallenge.documentLease;
          const accepted = challengeDocument(
            acceptedChallenge.windowGeneration,
            acceptedChallenge.documentToken,
            acceptedChallenge.challenge,
            acceptedChallenge.documentLease,
          );
          if (!accepted) {
            documentLease = null;
            documentBootAnnounced = false;
            scheduleDocumentBootRetry();
            return;
          }
        } else if (status === "registered") {
          if (!isDecimalToken(challenge?.documentLease)) {
            documentBootAnnounced = false;
            scheduleDocumentBootRetry();
            return;
          }
          documentLease = challenge.documentLease;
        }
        documentBootAnnounced = true;
        documentBootRetryAttempt = 0;
        clearDocumentBootRetry();
        announceDocumentReady();
      })
      .catch(() => {
        if (documentBootInFlight !== revision) return;
        documentBootAnnounced = false;
        documentBootInFlight = null;
        scheduleDocumentBootRetry();
      });
  };

  const cancel = (windowGeneration, documentToken) => {
    if (
      !current ||
      current.config.windowGeneration !== windowGeneration ||
      current.config.documentToken !== documentToken
    ) {
      return false;
    }
    dispose(current);
    return true;
  };

  const bindDocumentLease = (lease) => {
    if (
      !isDecimalToken(lease) ||
      documentLifecycleEnded ||
      documentLifecycleSuspended
    ) {
      return false;
    }
    if (documentLease !== null && documentLease !== lease) return false;
    documentLease = lease;
    announceDocumentBoot();
    return true;
  };

  const dispatch = (windowGeneration, documentToken, event, payload) => {
    if (
      !current ||
      current.disposed ||
      current.config.windowGeneration !== windowGeneration ||
      current.config.documentToken !== documentToken ||
      !CLOSED_EVENTS.has(event) ||
      typeof current.platform?.handle !== "function"
    ) {
      return false;
    }
    try {
      return current.platform.handle(event, payload) === true;
    } catch {
      return false;
    }
  };

  platforms.set("macos", async (context) => {
    const publishClearance = (value) => {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        return false;
      }
      return context.setClearance("left", value);
    };
    const render = (state) => {
      if (
        !state ||
        typeof state !== "object" ||
        typeof state.fullscreen !== "boolean" ||
        typeof state.clearance !== "number" ||
        !Number.isFinite(state.clearance) ||
        state.clearance < 0
      ) {
        return false;
      }
      if (state.fullscreen) {
        context.root.setAttribute("data-tauri-decoration-fullscreen", "");
      } else {
        context.root.removeAttribute("data-tauri-decoration-fullscreen");
      }
      return publishClearance(state.fullscreen ? 0 : state.clearance);
    };

    context.setClearance("left", 0);
    return {
      handle(event, payload) {
        return event === "macos-titlebar-state" && render(payload);
      },
    };
  });
  window[GLOBAL_NAME] = {
    version: VERSION,
    bindDocumentLease,
    cancel,
    challengeDocument,
    dispatch,
    install,
    installForDocument,
    status() {
      return { ...lastStatus };
    },
    registerPlatform(name, factory) {
      if ((name === "windows" || name === "linux") && typeof factory === "function") {
        platforms.set(name, factory);
      }
    },
  };
  const pendingDocumentLease = window[DOCUMENT_LEASE_SLOT];
  delete window[DOCUMENT_LEASE_SLOT];
  bindDocumentLease(pendingDocumentLease);
  const resumeDocument = (event) => {
    if (!event.persisted || documentLifecycleEnded) return;
    documentLifecycleSuspended = false;
    documentChallenge = null;
    documentBootAnnounced = false;
    documentReadyAnnounced = false;
    documentBootRetryAttempt = 0;
    documentReadyRetryAttempt = 0;
    documentBootInFlight = null;
    documentReadyInFlight = null;
    clearDocumentBootRetry();
    clearDocumentReadyRetry();
    announceDocumentBoot();
  };
  window.addEventListener("pagehide", cancelDocumentRetries);
  window.addEventListener("pageshow", resumeDocument);
  announceDocumentBoot();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", announceDocumentReady, { once: true });
  } else {
    queueMicrotask(announceDocumentReady);
  }
})();
