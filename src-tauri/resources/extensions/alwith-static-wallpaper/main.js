var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toCommonJS = (from) => {
  var entry = (__moduleCache ??= new WeakMap).get(from), desc;
  if (entry)
    return entry;
  entry = __defProp({}, "__esModule", { value: true });
  if (from && typeof from === "object" || typeof from === "function") {
    for (var key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(entry, key))
        __defProp(entry, key, {
          get: __accessProp.bind(from, key),
          enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
        });
  }
  __moduleCache.set(from, entry);
  return entry;
};
var __moduleCache;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};

// src/main.tsx
var exports_main = {};
__export(exports_main, {
  default: () => main_default
});
module.exports = __toCommonJS(exports_main);
var import_module_extension2 = require("@alwith/module-extension");
var import_react2 = require("@alwith/module-extension/react");
var import_dom = require("@alwith/module-extension/dom");

// src/contracts/wallpaper.ts
var import_module_extension = require("@alwith/module-extension");
var wallpaperCapability = import_module_extension.capability("alwith.u.wallpaper");

// src/catalogue.ts
var wallpapers = [
  { id: "mist", en: "Mountain mist", zh: "雾山" },
  { id: "dunes", en: "Quiet dunes", zh: "静沙" },
  { id: "night", en: "Nightfall", zh: "夜幕" },
  { id: "ocean", en: "Open water", zh: "海面" },
  { id: "forest", en: "Forest light", zh: "林光" },
  { id: "paper", en: "Paper folds", zh: "折纸" },
  { id: "clay", en: "Clay curves", zh: "陶弧" },
  { id: "glacier", en: "Glacier", zh: "冰川" }
];

// src/model.ts
class InvalidWallpaperDataError extends Error {
}
function parseConfig(input) {
  if (!input || Array.isArray(input) || typeof input !== "object")
    throw new InvalidWallpaperDataError("Invalid wallpaper settings / 壁纸设置数据损坏");
  const value = input;
  if (!["builtin", "imported"].includes(String(value.source)) || typeof value.id !== "string" || typeof value.visible !== "boolean" || !["cover", "contain"].includes(String(value.fit)) || typeof value.brightness !== "number" || !Number.isFinite(value.brightness) || value.brightness < 30 || value.brightness > 120 || typeof value.blur !== "number" || !Number.isFinite(value.blur) || value.blur < 0 || value.blur > 24)
    throw new InvalidWallpaperDataError("Invalid wallpaper settings / 壁纸设置数据损坏");
  if (value.source === "builtin" ? !wallpapers.some((item) => item.id === value.id) : !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value.id))
    throw new InvalidWallpaperDataError("Unknown wallpaper / 壁纸不存在");
  return {
    source: value.source,
    id: value.id,
    visible: value.visible,
    fit: value.fit,
    brightness: value.brightness,
    blur: value.blur
  };
}
async function loadDefaultConfig(url) {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Unable to load wallpaper defaults: ${response.status}`);
  const config = parseConfig(await response.json());
  if (config.source !== "builtin")
    throw new InvalidWallpaperDataError("Default wallpaper must be a bundled image");
  return config;
}
function readConfig(snapshot, defaults) {
  if (snapshot === null)
    return { ...defaults };
  if (snapshot.schemaVersion !== 1)
    throw new InvalidWallpaperDataError("Unsupported wallpaper data schema");
  return parseConfig(snapshot.value);
}

class WallpaperModel {
  snapshot = null;
  ready = false;
  config;
  defaults;
  data;
  constructor(data, defaults) {
    this.data = data;
    this.defaults = parseConfig(defaults);
    this.config = { ...this.defaults };
  }
  revision() {
    return this.snapshot?.revision ?? null;
  }
  async load() {
    const snapshot = await this.data.read();
    return this.acceptSnapshot(snapshot);
  }
  acceptSnapshot(snapshot) {
    this.snapshot = snapshot;
    this.ready = true;
    this.config = readConfig(snapshot, this.defaults);
    return { ...this.config };
  }
  async save(config) {
    if (!this.ready)
      throw new Error("Load wallpaper settings before saving");
    parseConfig(config);
    this.snapshot = await this.data.write({ ...config }, this.snapshot?.revision ?? null, 1);
    this.config = { ...config };
  }
}

// src/settings.tsx
var import_react = require("react");
var import_u_extension_ui = require("@alwith/u-extension-ui");

// src/strings.ts
var en = {
  title: "Wallpaper",
  description: "A quieter background for your workspace.",
  builtIn: "Collection",
  imported: "Your images",
  import: "Import image",
  importHint: "PNG, JPEG or WebP · up to 20 MiB · longest edge 8192 px",
  empty: "Import an image to make this space yours.",
  show: "Show wallpaper",
  cover: "Fill",
  contain: "Fit",
  fit: "Image placement",
  brightness: "Brightness",
  blur: "Blur",
  apply: "Apply",
  cancel: "Cancel",
  reset: "Restore defaults",
  remove: "Remove image",
  reload: "Reload",
  saved: "Wallpaper saved",
  changed: "Settings changed in another window. Reload before applying your changes.",
  loading: "Loading wallpapers…",
  imageError: "Unable to load this image. Choose another wallpaper or import it again.",
  preview: "Preview",
  previewTitle: "Room to think",
  previewText: "Your conversations stay clear.",
  off: "Wallpaper is off",
  selected: "Selected"
};
var zh = {
  title: "壁纸",
  description: "为工作空间添一份宁静。",
  builtIn: "内置壁纸",
  imported: "我的图片",
  import: "导入图片",
  importHint: "PNG、JPEG 或 WebP · 最大 20 MiB · 最长边 8192 像素",
  empty: "导入喜欢的图片，布置你的工作空间。",
  show: "显示壁纸",
  cover: "填充",
  contain: "适应",
  fit: "图片布局",
  brightness: "亮度",
  blur: "模糊",
  apply: "应用",
  cancel: "取消",
  reset: "恢复默认",
  remove: "移除图片",
  reload: "重新读取",
  saved: "壁纸已保存",
  changed: "其他窗口已修改设置，请重新读取后再应用。",
  loading: "正在加载壁纸…",
  imageError: "无法加载图片，请选择其他壁纸或重新导入。",
  preview: "预览",
  previewTitle: "留白，给思考",
  previewText: "对话内容始终清晰。",
  off: "壁纸已关闭",
  selected: "已选择"
};

// src/settings.tsx
var jsx_dev_runtime = require("react/jsx-dev-runtime");
function describeError(error) {
  if (error instanceof Error)
    return error.message;
  if (typeof error === "object" && error !== null && "message" in error)
    return String(error.message);
  return String(error);
}
function WallpaperSettings({
  context,
  host,
  defaults,
  cancellation
}) {
  const text = host.language().startsWith("zh") ? zh : en;
  const [model] = import_react.useState(() => new WallpaperModel(context.data, defaults));
  const [draft, setDraft] = import_react.useState({ ...defaults });
  const [images, setImages] = import_react.useState([]);
  const [busy, setBusy] = import_react.useState(true);
  const [ready, setReady] = import_react.useState(false);
  const [dirty, setDirty] = import_react.useState(false);
  const [stale, setStale] = import_react.useState(false);
  const [error, setError] = import_react.useState(null);
  const [imageError, setImageError] = import_react.useState(false);
  const [status, setStatus] = import_react.useState("");
  const dirtyRef = import_react.useRef(false);
  const working = import_react.useRef(false);
  const refreshPending = import_react.useRef(false);
  const refreshData = import_react.useRef(null);
  const mounted = import_react.useRef(true);
  const live = import_react.useCallback(() => mounted.current && !cancellation.aborted, [cancellation]);
  const markDirty = import_react.useCallback((value) => {
    dirtyRef.current = value;
    setDirty(value);
  }, []);
  const url = (source, id) => source === "builtin" ? context.resource(`assets/${id}.jpg`) : host.imageUrl(id);
  const change = (patch) => {
    setDraft((previous) => ({ ...previous, ...patch }));
    markDirty(true);
    setStatus("");
  };
  const load = import_react.useCallback(async () => {
    const config = await model.load();
    if (!live())
      return;
    setDraft(config);
    markDirty(false);
    setStale(false);
    setReady(true);
    setError(null);
  }, [model, live, markDirty]);
  const perform = import_react.useCallback((operation) => {
    if (working.current || !live())
      return;
    working.current = true;
    setBusy(true);
    setError(null);
    setStatus("");
    operation().catch((cause) => {
      if (live())
        setError(describeError(cause));
    }).finally(() => {
      working.current = false;
      if (live()) {
        setBusy(false);
        if (refreshPending.current) {
          refreshPending.current = false;
          refreshData.current?.();
        }
      }
    });
  }, [live]);
  import_react.useEffect(() => {
    mounted.current = true;
    let refresh = 0;
    const reload = async () => {
      const current = ++refresh;
      try {
        const snapshot = await context.data.read();
        if (!live() || current !== refresh || (snapshot?.revision ?? null) === model.revision())
          return;
        if (working.current) {
          refreshPending.current = true;
          return;
        }
        if (dirtyRef.current) {
          setStale(true);
          setStatus(text.changed);
          return;
        }
        const config = model.acceptSnapshot(snapshot);
        if (live() && current === refresh && !dirtyRef.current) {
          setDraft(config);
          setReady(true);
          setError(null);
        }
      } catch (cause) {
        if (live() && current === refresh)
          setError(describeError(cause));
      }
    };
    refreshData.current = reload;
    const unsubscribe = context.data.subscribe(() => {
      reload();
    });
    perform(async () => {
      const results = await Promise.allSettled([
        host.listImages().then((entries) => {
          if (live())
            setImages(entries);
        }),
        load()
      ]);
      const errors = results.flatMap((result) => result.status === "rejected" ? [describeError(result.reason)] : []);
      if (errors.length)
        throw new Error(errors.join("; "));
    });
    const refreshImages = () => {
      host.listImages().then((entries) => {
        if (live())
          setImages(entries);
      }).catch((cause) => {
        if (live())
          setError(describeError(cause));
      });
    };
    window.addEventListener("focus", refreshImages);
    return () => {
      mounted.current = false;
      refreshData.current = null;
      refresh++;
      window.removeEventListener("focus", refreshImages);
      Promise.resolve(unsubscribe()).catch(host.reportError);
    };
  }, [context, host, model, live, text.changed, perform, load]);
  const apply = async (config) => {
    await model.save(config);
    if (!live())
      return;
    setDraft({ ...config });
    markDirty(false);
    setStale(false);
    setReady(true);
    setStatus(text.saved);
  };
  const setVisible = async (visible) => {
    await model.save({ ...model.config, visible });
    if (!live())
      return;
    setDraft((previous) => ({ ...previous, visible }));
    setStatus(text.saved);
  };
  const previewUrl = url(draft.source, draft.id);
  return /* @__PURE__ */ jsx_dev_runtime.jsxDEV("section", {
    className: "wallpaper-settings",
    "aria-busy": busy,
    children: [
      /* @__PURE__ */ jsx_dev_runtime.jsxDEV("header", {
        children: /* @__PURE__ */ jsx_dev_runtime.jsxDEV("p", {
          children: text.description
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsx_dev_runtime.jsxDEV("div", {
        className: "wallpaper-preview",
        "aria-label": text.preview,
        children: [
          draft.visible && /* @__PURE__ */ jsx_dev_runtime.jsxDEV("img", {
            src: previewUrl,
            alt: "",
            className: "wallpaper-preview-image",
            style: { objectFit: draft.fit, filter: `brightness(${draft.brightness / 100}) blur(${draft.blur}px)` },
            onError: () => setImageError(true),
            onLoad: () => setImageError(false)
          }, previewUrl, false, undefined, this),
          /* @__PURE__ */ jsx_dev_runtime.jsxDEV("div", {
            className: "wallpaper-preview-panel",
            children: [
              /* @__PURE__ */ jsx_dev_runtime.jsxDEV("span", {
                children: draft.visible ? text.previewTitle : text.off
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsx_dev_runtime.jsxDEV("p", {
                children: text.previewText
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsx_dev_runtime.jsxDEV("div", {}, undefined, false, undefined, this),
              /* @__PURE__ */ jsx_dev_runtime.jsxDEV("div", {}, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this)
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ jsx_dev_runtime.jsxDEV("div", {
        className: "wallpaper-show",
        children: [
          /* @__PURE__ */ jsx_dev_runtime.jsxDEV(import_u_extension_ui.Label, {
            htmlFor: "wallpaper-visible",
            children: text.show
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsx_dev_runtime.jsxDEV(import_u_extension_ui.Switch, {
            id: "wallpaper-visible",
            checked: draft.visible,
            disabled: busy || !ready,
            onCheckedChange: (visible) => perform(() => setVisible(visible))
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ jsx_dev_runtime.jsxDEV("section", {
        "aria-label": text.builtIn,
        children: [
          /* @__PURE__ */ jsx_dev_runtime.jsxDEV("h3", {
            children: text.builtIn
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsx_dev_runtime.jsxDEV("div", {
            className: "wallpaper-grid",
            children: wallpapers.map((item) => {
              const name = host.language().startsWith("zh") ? item.zh : item.en;
              const selected = draft.source === "builtin" && draft.id === item.id;
              return /* @__PURE__ */ jsx_dev_runtime.jsxDEV(import_u_extension_ui.Button, {
                variant: "outline",
                className: "wallpaper-tile",
                disabled: busy || !ready,
                "aria-label": name,
                "aria-pressed": selected,
                onClick: () => change({ source: "builtin", id: item.id }),
                children: [
                  /* @__PURE__ */ jsx_dev_runtime.jsxDEV("img", {
                    src: url("builtin", item.id),
                    alt: "",
                    loading: "lazy"
                  }, undefined, false, undefined, this),
                  /* @__PURE__ */ jsx_dev_runtime.jsxDEV("span", {
                    children: name
                  }, undefined, false, undefined, this),
                  selected && /* @__PURE__ */ jsx_dev_runtime.jsxDEV("span", {
                    className: "wallpaper-check",
                    "aria-hidden": "true",
                    children: "✓"
                  }, undefined, false, undefined, this)
                ]
              }, item.id, true, undefined, this);
            })
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ jsx_dev_runtime.jsxDEV("section", {
        "aria-label": text.imported,
        children: [
          /* @__PURE__ */ jsx_dev_runtime.jsxDEV("div", {
            className: "wallpaper-library-heading",
            children: [
              /* @__PURE__ */ jsx_dev_runtime.jsxDEV("h3", {
                children: text.imported
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsx_dev_runtime.jsxDEV(import_u_extension_ui.Button, {
                variant: "outline",
                size: "sm",
                disabled: busy,
                onClick: () => perform(async () => {
                  const imported = await host.importImage();
                  if (!imported || !live())
                    return;
                  const entries = await host.listImages();
                  if (live()) {
                    setImages(entries);
                    change({ source: "imported", id: imported.id });
                  }
                }),
                children: text.import
              }, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this),
          /* @__PURE__ */ jsx_dev_runtime.jsxDEV("p", {
            className: "wallpaper-hint",
            children: text.importHint
          }, undefined, false, undefined, this),
          images.length === 0 ? /* @__PURE__ */ jsx_dev_runtime.jsxDEV("p", {
            className: "wallpaper-hint",
            children: text.empty
          }, undefined, false, undefined, this) : /* @__PURE__ */ jsx_dev_runtime.jsxDEV("div", {
            className: "wallpaper-grid",
            children: images.map((item) => /* @__PURE__ */ jsx_dev_runtime.jsxDEV("div", {
              className: "wallpaper-imported-item",
              children: [
                /* @__PURE__ */ jsx_dev_runtime.jsxDEV(import_u_extension_ui.Button, {
                  variant: "outline",
                  className: "wallpaper-tile",
                  disabled: busy || !ready,
                  "aria-label": item.name,
                  "aria-pressed": draft.source === "imported" && draft.id === item.id,
                  onClick: () => change({ source: "imported", id: item.id }),
                  children: [
                    /* @__PURE__ */ jsx_dev_runtime.jsxDEV("img", {
                      src: host.imageUrl(item.id),
                      alt: "",
                      loading: "lazy"
                    }, undefined, false, undefined, this),
                    /* @__PURE__ */ jsx_dev_runtime.jsxDEV("span", {
                      children: item.name
                    }, undefined, false, undefined, this)
                  ]
                }, undefined, true, undefined, this),
                /* @__PURE__ */ jsx_dev_runtime.jsxDEV(import_u_extension_ui.Button, {
                  variant: "ghost",
                  size: "sm",
                  disabled: busy || stale || model.config.source === "imported" && model.config.id === item.id,
                  onClick: () => perform(async () => {
                    if (!await host.removeImage(item.id) || !live())
                      return;
                    setImages((previous) => previous.filter((image) => image.id !== item.id));
                    if (draft.source === "imported" && draft.id === item.id)
                      change({ source: "builtin", id: defaults.id });
                  }),
                  children: text.remove
                }, undefined, false, undefined, this)
              ]
            }, item.id, true, undefined, this))
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ jsx_dev_runtime.jsxDEV("div", {
        className: "wallpaper-adjustments",
        children: [
          /* @__PURE__ */ jsx_dev_runtime.jsxDEV("div", {
            children: [
              /* @__PURE__ */ jsx_dev_runtime.jsxDEV(import_u_extension_ui.Label, {
                children: text.fit
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsx_dev_runtime.jsxDEV("div", {
                className: "wallpaper-fit",
                role: "group",
                "aria-label": text.fit,
                children: ["cover", "contain"].map((fit) => /* @__PURE__ */ jsx_dev_runtime.jsxDEV(import_u_extension_ui.Button, {
                  variant: draft.fit === fit ? "secondary" : "outline",
                  size: "sm",
                  "aria-pressed": draft.fit === fit,
                  disabled: busy || !ready,
                  onClick: () => change({ fit }),
                  children: text[fit]
                }, fit, false, undefined, this))
              }, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this),
          /* @__PURE__ */ jsx_dev_runtime.jsxDEV("div", {
            children: [
              /* @__PURE__ */ jsx_dev_runtime.jsxDEV(import_u_extension_ui.Label, {
                htmlFor: "wallpaper-brightness",
                children: [
                  text.brightness,
                  /* @__PURE__ */ jsx_dev_runtime.jsxDEV("span", {
                    children: [
                      draft.brightness,
                      "%"
                    ]
                  }, undefined, true, undefined, this)
                ]
              }, undefined, true, undefined, this),
              /* @__PURE__ */ jsx_dev_runtime.jsxDEV(import_u_extension_ui.Input, {
                id: "wallpaper-brightness",
                type: "range",
                min: 30,
                max: 120,
                step: 1,
                value: draft.brightness,
                disabled: busy || !ready,
                onChange: (event) => change({ brightness: Number(event.currentTarget.value) })
              }, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this),
          /* @__PURE__ */ jsx_dev_runtime.jsxDEV("div", {
            children: [
              /* @__PURE__ */ jsx_dev_runtime.jsxDEV(import_u_extension_ui.Label, {
                htmlFor: "wallpaper-blur",
                children: [
                  text.blur,
                  /* @__PURE__ */ jsx_dev_runtime.jsxDEV("span", {
                    children: [
                      draft.blur,
                      "px"
                    ]
                  }, undefined, true, undefined, this)
                ]
              }, undefined, true, undefined, this),
              /* @__PURE__ */ jsx_dev_runtime.jsxDEV(import_u_extension_ui.Input, {
                id: "wallpaper-blur",
                type: "range",
                min: 0,
                max: 24,
                step: 1,
                value: draft.blur,
                disabled: busy || !ready,
                onChange: (event) => change({ blur: Number(event.currentTarget.value) })
              }, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this)
        ]
      }, undefined, true, undefined, this),
      imageError && draft.visible && /* @__PURE__ */ jsx_dev_runtime.jsxDEV("p", {
        role: "alert",
        className: "wallpaper-error",
        children: text.imageError
      }, undefined, false, undefined, this),
      error && /* @__PURE__ */ jsx_dev_runtime.jsxDEV("div", {
        role: "alert",
        className: "wallpaper-error",
        children: [
          error,
          /* @__PURE__ */ jsx_dev_runtime.jsxDEV(import_u_extension_ui.Button, {
            variant: "outline",
            size: "sm",
            disabled: busy,
            onClick: () => perform(load),
            children: text.reload
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ jsx_dev_runtime.jsxDEV("p", {
        role: "status",
        className: "wallpaper-hint",
        children: busy ? text.loading : status
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsx_dev_runtime.jsxDEV("footer", {
        className: "wallpaper-footer",
        children: [
          /* @__PURE__ */ jsx_dev_runtime.jsxDEV(import_u_extension_ui.Button, {
            disabled: busy || !ready || !dirty || imageError && draft.visible,
            onClick: () => perform(() => apply(draft)),
            children: text.apply
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsx_dev_runtime.jsxDEV(import_u_extension_ui.Button, {
            variant: "outline",
            disabled: busy || !dirty,
            onClick: () => perform(load),
            children: text.cancel
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsx_dev_runtime.jsxDEV(import_u_extension_ui.Button, {
            variant: "ghost",
            disabled: busy,
            onClick: () => perform(async () => {
              try {
                await model.load();
              } catch (cause) {
                if (!(cause instanceof InvalidWallpaperDataError))
                  throw cause;
              }
              await apply({ ...defaults });
            }),
            children: text.reset
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// src/main.tsx
var jsx_dev_runtime2 = require("react/jsx-dev-runtime");
var main_default = import_module_extension2.defineExtension((context) => {
  const host = context.capability(wallpaperCapability);
  if (!host)
    throw new Error("Wallpaper host capability unavailable");
  let request = 0;
  const refresh = async (defaults) => {
    const current = ++request;
    try {
      const config = readConfig(await context.data.read(), defaults);
      if (context.cancellation.aborted || current !== request)
        return;
      host.show(config.visible ? {
        url: config.source === "builtin" ? context.resource(`assets/${config.id}.jpg`) : host.imageUrl(config.id),
        fit: config.fit,
        brightness: config.brightness,
        blur: config.blur
      } : null);
    } catch (error) {
      if (!context.cancellation.aborted && current === request)
        host.reportError(error);
    }
  };
  const registerSettings = (defaults) => {
    const unregister = context.view("settingsPages", import_react2.mountReact({
      id: "wallpaper",
      title: host.language().startsWith("zh") ? "壁纸" : "Wallpaper",
      icon: "panel",
      order: 5,
      render: (mount) => /* @__PURE__ */ jsx_dev_runtime2.jsxDEV(WallpaperSettings, {
        context,
        host,
        defaults,
        cancellation: mount.cancellation
      }, undefined, false, undefined, this)
    }));
    stopSettings = unregister;
  };
  let settingsTask = Promise.resolve();
  let stopSettings;
  return {
    async onload() {
      const defaults = await loadDefaultConfig(context.resource("data.json"));
      if (context.cancellation.aborted)
        return;
      context.own(import_dom.attachStylesheet(context, "styles.css", document));
      registerSettings(defaults);
      context.own(host.subscribeLanguage(() => {
        settingsTask = settingsTask.then(async () => {
          await stopSettings?.();
          if (!context.cancellation.aborted)
            registerSettings(defaults);
        }).catch(host.reportError);
      }));
      context.own(context.data.subscribe(() => {
        refresh(defaults);
      }));
      await refresh(defaults);
    }
  };
});
