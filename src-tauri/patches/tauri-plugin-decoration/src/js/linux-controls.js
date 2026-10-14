(() => {
  "use strict";

  const runtime = window.__TAURI_PLUGIN_DECORATION__;
  if (!runtime) return;

  runtime.registerPlatform("linux", async (context) => {
    const pngDataUrl = (value) =>
      typeof value === "string" &&
      /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
        ? value
        : null;
    const config = context.config;
    const hosts = new Map();
    let maximize = null;
    let fullscreen = Boolean(config.fullscreen);

    const createHost = (side) => {
      const host = document.createElement("div");
      host.setAttribute("data-tauri-decoration-controls", "");
      host.setAttribute("data-tauri-decoration-platform", "linux");
      host.setAttribute("data-tauri-decoration-side", side);
      host.setAttribute("role", "group");
      host.setAttribute("aria-label", "Window controls");
      context.root.appendChild(host);
      hosts.set(side, host);
      return host;
    };

    const createButton = (host, name, label, action) => {
      const state = { actionLocked: false };
      const button = document.createElement("button");
      button.setAttribute("type", "button");
      button.setAttribute("data-tauri-decoration-control", name);
      button.setAttribute("data-tauri-decoration-icon", name);
      button.setAttribute("aria-label", label);
      const image = document.createElement("img");
      image.setAttribute("alt", "");
      image.setAttribute("aria-hidden", "true");
      const source = pngDataUrl(config.icons[name]);
      if (source) image.setAttribute("src", source);
      else button.setAttribute("data-tauri-decoration-icon-fallback", "");
      image.addEventListener("error", () => {
        if (!context.isCurrent()) return;
        image.removeAttribute("src");
        button.setAttribute("data-tauri-decoration-icon-fallback", "");
      });
      button.appendChild(image);

      button.addEventListener("click", (event) => {
        event.preventDefault();
        if (state.actionLocked || !context.isCurrent()) return;
        state.actionLocked = true;
        Promise.resolve()
          .then(action)
          .catch((error) => {
            console.error(
              `tauri-plugin-decoration: Linux ${name} action failed`,
              error,
            );
          })
          .finally(() => {
            state.actionLocked = false;
          });
      });
      host.appendChild(button);
      return { button, image };
    };

    const renderMaximized = (maximized) => {
      if (!maximize) return;
      const icon = maximized ? "restore" : "maximize";
      const source = pngDataUrl(config.icons[icon]);
      maximize.button.setAttribute("data-tauri-decoration-icon", icon);
      maximize.button.setAttribute(
        "aria-label",
        maximized ? "Restore window size" : "Maximize window size",
      );
      if (source) {
        maximize.image.setAttribute("src", source);
        maximize.button.removeAttribute("data-tauri-decoration-icon-fallback");
      } else {
        maximize.image.removeAttribute("src");
        maximize.button.setAttribute("data-tauri-decoration-icon-fallback", "");
      }
    };

    const measuredWidth = (side) => {
      const width = hosts.get(side)?.getBoundingClientRect().width ?? 0;
      return Number.isFinite(width) && width >= 0 ? width : 0;
    };

    const publishClearances = () => {
      context.setClearance("left", fullscreen ? 0 : measuredWidth("left"));
      context.setClearance("right", fullscreen ? 0 : measuredWidth("right"));
    };

    const renderFullscreen = (value) => {
      fullscreen = Boolean(value);
      if (fullscreen) {
        context.root.setAttribute("data-tauri-decoration-fullscreen", "");
      } else {
        context.root.removeAttribute("data-tauri-decoration-fullscreen");
      }
      publishClearances();
    };

    const actions = {
      minimize: (host) =>
        createButton(host, "minimize", "Minimize window", () =>
          context.windowControl("minimize"),
        ),
      maximize: (host) => {
        maximize = createButton(host, "maximize", "Maximize window size", () =>
          context.windowControl("toggleMaximize"),
        );
      },
      close: (host) =>
        createButton(host, "close", "Close window", () =>
          context.windowControl("close"),
        ),
    };
    for (const side of ["left", "right"]) {
      if (config.layout[side].length === 0) continue;
      const host = createHost(side);
      for (const control of config.layout[side]) actions[control](host);
    }

    renderMaximized(Boolean(config.maximized));
    renderFullscreen(fullscreen);

    let windowStateRevision = 0;
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
    };
    if (hosts.size === 0) {
      publishClearances();
      return {
        handle(event, payload) {
          if (event !== "window-state") return false;
          onWindowState(payload);
          return true;
        },
      };
    }
    if (typeof ResizeObserver !== "function") {
      throw new Error("ResizeObserver is required for measured window controls");
    }
    const observer = new ResizeObserver(() => {
      if (context.isCurrent()) publishClearances();
    });
    for (const host of hosts.values()) observer.observe(host);
    context.addDisposer(() => observer.disconnect());

    return {
      handle(event, payload) {
        if (event !== "window-state") return false;
        onWindowState(payload);
        return true;
      },
    };
  });
})();
