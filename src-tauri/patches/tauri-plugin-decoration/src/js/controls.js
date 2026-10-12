(() => {
  "use strict";

  const runtime = window.__TAURI_PLUGIN_DECORATION__;
  if (!runtime) return;

  runtime.registerPlatform("windows", async (context) => {
    const controls = new Set(
      Array.isArray(context.config.controls) ? context.config.controls : [],
    );
    const host = document.createElement("div");
    host.setAttribute("data-tauri-decoration-controls", "");
    host.setAttribute("data-tauri-decoration-platform", "windows");
    host.setAttribute("role", "group");
    host.setAttribute("aria-label", "Window controls");
    context.root.appendChild(host);

    const buttons = new Map();
    let activeControl = null;
    let fullscreen = Boolean(context.config.fullscreen);
    let windowStateRevision = 0;

    const setActive = (control) => {
      activeControl = buttons.has(control) ? control : null;
      for (const [name, button] of buttons) {
        if (name === activeControl) {
          button.setAttribute("data-tauri-decoration-hover", "");
        } else {
          button.removeAttribute("data-tauri-decoration-hover");
        }
      }
    };

    const createButton = (name, label, glyph, action) => {
      const button = document.createElement("button");
      button.setAttribute("type", "button");
      button.setAttribute("data-tauri-decoration-control", name);
      button.setAttribute("aria-label", label);
      button.textContent = glyph;

      let actionLocked = false;
      const run = async () => {
        if (actionLocked || !context.isCurrent()) return;
        actionLocked = true;
        setActive(null);
        try {
          await action();
        } catch (error) {
          console.error(
            `tauri-plugin-decoration: Windows ${name} action failed`,
            error,
          );
        } finally {
          actionLocked = false;
        }
      };
      button.addEventListener("mouseenter", () => setActive(name));
      button.addEventListener("mouseleave", () => {
        if (activeControl === name) setActive(null);
      });
      button.addEventListener("click", (event) => {
        event.preventDefault();
        void run();
      });
      buttons.set(name, button);
      host.appendChild(button);
      return { button, run };
    };

    if (controls.has("minimize")) {
      createButton("minimize", "Minimize window", "\uE921", () =>
        context.windowControl("minimize"),
      );
    }

    let maximize = null;
    if (controls.has("maximize")) {
      maximize = createButton("maximize", "Maximize window size", "\uE922", () =>
        context.windowControl("toggleMaximize"),
      );
    }

    if (controls.has("close")) {
      createButton("close", "Close window", "\uE8BB", () =>
        context.windowControl("close"),
      );
    }

    const measuredWidth = () => {
      const width = host.getBoundingClientRect().width;
      return Number.isFinite(width) && width >= 0 ? width : 0;
    };

    const publishClearance = () => {
      context.setClearance("left", 0);
      context.setClearance("right", fullscreen ? 0 : measuredWidth());
    };

    const roundedRectangle = (rectangle, scale) => {
      const left = Math.round(rectangle.left * scale);
      const right = Math.round(rectangle.right * scale);
      const top = Math.round(rectangle.top * scale);
      const bottom = Math.round(rectangle.bottom * scale);
      return {
        height: Math.max(0, bottom - top),
        width: Math.max(0, right - left),
        x: left,
        y: top,
      };
    };

    const snapGeometry = () => {
      if (!maximize || fullscreen) return null;
      const rectangle = maximize.button.getBoundingClientRect();
      const titlebar = context.root.getBoundingClientRect();
      const controlBand = host.getBoundingClientRect();
      const scale =
        Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0
          ? window.devicePixelRatio
          : 1;
      const measuredRectangle = roundedRectangle(rectangle, scale);
      const measuredTitlebar = roundedRectangle(titlebar, scale);
      const measuredControlBand = roundedRectangle(controlBand, scale);
      const geometry = {
        controlBandWidth: measuredControlBand.width,
        height: measuredRectangle.height,
        titlebarHeight: measuredTitlebar.height,
        width: measuredRectangle.width,
        x: measuredRectangle.x,
        y: measuredRectangle.y,
      };
      return geometry.width > 0 &&
        geometry.height > 0 &&
        geometry.titlebarHeight > 0 &&
        geometry.controlBandWidth > 0
        ? geometry
        : null;
    };

    let geometrySequence = 0;
    let geometryDeliveryActive = false;
    let pendingActivationMeasurement = null;
    let geometryInFlight = false;
    let latestDesired = null;
    let desiredRevision = 0;
    let outboundGeometry = null;
    let outboundRevision = 0;
    let retryTimer = null;
    let retryAttempts = 0;
    let protocolRetries = 0;
    let deliveryPhase = "healthy";
    const retryDelays = [16, 64, 256];

    let lastLoggedErrorMsg = null;
    let lastLoggedErrorTime = 0;
    let hasLoggedFailure = false;

    const logGeometryError = (error) => {
      const msg = String(error?.message || error);
      const now = Date.now();
      if (
        !hasLoggedFailure ||
        msg !== lastLoggedErrorMsg ||
        now - lastLoggedErrorTime >= 300000
      ) {
        console.error(
          "tauri-plugin-decoration: updating Windows Snap geometry failed",
          error,
        );
        lastLoggedErrorMsg = msg;
        lastLoggedErrorTime = now;
        hasLoggedFailure = true;
      }
    };

    const getRetryDelay = (attempt) => {
      if (attempt < retryDelays.length) {
        return retryDelays[attempt];
      }
      const exp = Math.min(1000 * Math.pow(2, attempt - retryDelays.length), 10000);
      const jitter = Math.floor(exp * 0.1 * Math.random());
      return exp + jitter;
    };

    const measureGeometryState = () => {
      if (!maximize) return null;
      const geometry = snapGeometry();
      return geometry
        ? { geometry, kind: "geometry" }
        : { fallback: false, kind: "disabled" };
    };

    const initialGeometryState = () => {
      const state = measureGeometryState();
      return state ? { ...state, sequence: String(++geometrySequence) } : null;
    };

    const queueLatestGeometry = () => {
      if (!latestDesired) return;
      outboundGeometry = {
        ...latestDesired,
        sequence: String(++geometrySequence),
      };
      outboundRevision = desiredRevision;
    };

    const retryGeometryExactly = (geometry, revision) => {
      outboundGeometry = {
        ...geometry,
      };
      outboundRevision = revision;
    };

    const queueFallbackGeometry = () => {
      outboundGeometry = {
        fallback: true,
        kind: "disabled",
        sequence: String(++geometrySequence),
      };
      outboundRevision = desiredRevision;
    };

    const scheduleGeometryDelivery = (delay = 0) => {
      if (
        !outboundGeometry ||
        geometryInFlight ||
        !geometryDeliveryActive ||
        !context.isCurrent() ||
        retryTimer !== null
      ) {
        return;
      }
      if (delay === 0) {
        void deliverGeometry();
        return;
      }
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        void deliverGeometry();
      }, delay);
    };

    const deliverGeometry = async () => {
      if (!outboundGeometry || geometryInFlight || !context.isCurrent()) return;
      geometryInFlight = true;
      const geometry = outboundGeometry;
      const sentRevision = outboundRevision;
      outboundGeometry = null;
      let nextDelay = null;
      try {
        const outcome = await context.reportGeometry(geometry);
        if (outcome === "inactive" || outcome === "cancelled") return;
        if (outcome?.status === "stale") {
          const cursor = Number(outcome.cursor);
          if (
            !Number.isSafeInteger(cursor) ||
            cursor < 0 ||
            protocolRetries >= retryDelays.length
          ) {
            deliveryPhase = "degraded";
            context.markGeometryDegraded();
            return;
          }
          geometrySequence = cursor;
          protocolRetries += 1;
          deliveryPhase = "resyncing";
          if (geometry.kind === "disabled" && geometry.fallback) {
            queueFallbackGeometry();
          } else if (latestDesired) {
            queueLatestGeometry();
          } else {
            retryGeometryExactly(geometry, sentRevision);
          }
          nextDelay = getRetryDelay(protocolRetries - 1);
          return;
        }
        if (outcome?.status !== "applied") {
          context.markGeometryDegraded();
          return;
        }
        protocolRetries = 0;
        const isTrueRecovery =
          geometry.kind === "geometry" ||
          (geometry.kind === "disabled" && !geometry.fallback);
        if (isTrueRecovery) {
          if (hasLoggedFailure) {
            console.info(
              "tauri-plugin-decoration: Windows Snap geometry delivery recovered",
            );
          }
          retryAttempts = 0;
          deliveryPhase = "healthy";
          lastLoggedErrorMsg = null;
          hasLoggedFailure = false;
          if (latestDesired && desiredRevision !== sentRevision) {
            queueLatestGeometry();
          }
        } else if (geometry.kind === "disabled" && geometry.fallback) {
          // The native safety state was accepted, but it is not a geometry
          // recovery. Keep the degraded state and probe the latest desired
          // layout later instead of falsely reporting recovery.
          deliveryPhase = "degraded";
          retryAttempts = 0;
          latestDesired = measureGeometryState();
          desiredRevision += 1;
          if (latestDesired) {
            queueLatestGeometry();
            nextDelay = getRetryDelay(0);
          }
        }
      } catch (error) {
        if (!context.isCurrent()) return;
        logGeometryError(error);
        if (retryAttempts < retryDelays.length) {
          if (!outboundGeometry) {
            // A retry is the same exact-next native transaction. A newer
            // measurement may replace its payload, but not its sequence.
            if (geometry.kind === "disabled" && geometry.fallback) {
              outboundGeometry = geometry;
              outboundRevision = sentRevision;
            } else {
              retryGeometryExactly(geometry, sentRevision);
            }
          }
          nextDelay = retryDelays[retryAttempts];
          retryAttempts += 1;
          deliveryPhase =
            geometry.kind === "disabled" && geometry.fallback
              ? "fallback-pending"
              : "retrying";
        } else if (geometry.kind !== "disabled" && deliveryPhase !== "fallback-pending") {
          context.markGeometryDegraded();
          deliveryPhase = "fallback-pending";
          const desired = latestDesired;
          // Always prioritize removing native Snap hit testing at the
          // threshold. A newer measurement must not replace this command.
          if (desired?.kind === "disabled" && !desired.fallback) {
            queueLatestGeometry();
          } else {
            queueFallbackGeometry();
          }
          retryAttempts = 0;
          nextDelay = 0;
        } else {
          context.markGeometryDegraded();
          deliveryPhase = "fallback-pending";
          if (!outboundGeometry) {
            // Keep retrying the safety command even if ResizeObserver keeps
            // publishing newer desired geometry while transport is down.
            outboundGeometry = geometry;
            outboundRevision = sentRevision;
          }
          nextDelay = getRetryDelay(retryAttempts);
          retryAttempts += 1;
        }
      } finally {
        geometryInFlight = false;
        if (nextDelay !== null) {
          scheduleGeometryDelivery(nextDelay);
        } else if (outboundGeometry && context.isCurrent()) {
          scheduleGeometryDelivery();
        }
      }
    };

    const publishGeometry = () => {
      if (!maximize) return;
      if (!geometryDeliveryActive) {
        pendingActivationMeasurement = measureGeometryState();
        return;
      }
      latestDesired = measureGeometryState();
      desiredRevision += 1;
      if (deliveryPhase === "healthy") {
        if (geometryInFlight) return;
        if (!outboundGeometry) queueLatestGeometry();
        if (retryTimer !== null) {
          window.clearTimeout(retryTimer);
          retryTimer = null;
        }
        scheduleGeometryDelivery();
      } else if (deliveryPhase === "resyncing") {
        if (!outboundGeometry && !geometryInFlight) queueLatestGeometry();
        if (retryTimer === null && !geometryInFlight) {
          scheduleGeometryDelivery(getRetryDelay(protocolRetries - 1));
        }
      } else {
        if (deliveryPhase !== "fallback-pending") {
          if (!outboundGeometry && !geometryInFlight) queueLatestGeometry();
        }
        if (retryTimer === null && !geometryInFlight && outboundGeometry) {
          scheduleGeometryDelivery(getRetryDelay(retryAttempts));
        }
      }
    };

    const renderMaximized = (maximized) => {
      if (!maximize) return;
      const glyph = maximized ? "\uE923" : "\uE922";
      maximize.button.textContent = glyph;
      maximize.button.setAttribute(
        "aria-label",
        maximized ? "Restore window size" : "Maximize window size",
      );
    };

    const renderFullscreen = (value) => {
      fullscreen = Boolean(value);
      if (fullscreen) {
        context.root.setAttribute("data-tauri-decoration-fullscreen", "");
        setActive(null);
      } else {
        context.root.removeAttribute("data-tauri-decoration-fullscreen");
      }
      publishClearance();
    };

    renderMaximized(Boolean(context.config.maximized));
    renderFullscreen(fullscreen);

    const onWindowState = (state) => {
      if (
        !context.isCurrent() ||
        !state ||
        typeof state.maximized !== "boolean" ||
        typeof state.fullscreen !== "boolean" ||
        !Number.isSafeInteger(state.revision) ||
        state.revision <= windowStateRevision
      ) {
        return;
      }
      windowStateRevision = state.revision;
      renderMaximized(state.maximized);
      renderFullscreen(state.fullscreen);
      publishGeometry();
    };
    if (typeof ResizeObserver !== "function") {
      throw new Error("ResizeObserver is required for measured window controls");
    }
    const observer = new ResizeObserver(() => {
      if (!context.isCurrent()) return;
      publishClearance();
      publishGeometry();
    });
    observer.observe(context.root);
    observer.observe(host);
    if (maximize) observer.observe(maximize.button);
    context.addDisposer(() => {
      geometryDeliveryActive = false;
      pendingActivationMeasurement = null;
      latestDesired = null;
      desiredRevision = 0;
      outboundGeometry = null;
      outboundRevision = 0;
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
      observer.disconnect();
    });

    return {
      activate() {
        if (geometryDeliveryActive || !context.isCurrent()) return;
        geometryDeliveryActive = true;
        if (pendingActivationMeasurement) {
          latestDesired = pendingActivationMeasurement;
          desiredRevision += 1;
          queueLatestGeometry();
          pendingActivationMeasurement = null;
          scheduleGeometryDelivery();
        }
      },
      snapGeometry: initialGeometryState,
      handle(event, payload) {
        switch (event) {
          case "snap-mouseenter":
          case "snap-mousedown":
          case "snap-mouseup":
            setActive("maximize");
            return Boolean(maximize);
          case "snap-mouseleave":
            setActive(null);
            return Boolean(maximize);
          case "snap-click":
            if (!maximize) return false;
            void maximize.run();
            return true;
          case "window-state":
            onWindowState(payload);
            return true;
          default:
            return false;
        }
      },
    };
  });
})();
