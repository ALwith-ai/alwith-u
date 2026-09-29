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
var import_module_extension = require("@alwith/module-extension");
var import_dom = require("@alwith/module-extension/dom");
var import_react = require("@alwith/module-extension/react");
var import_react2 = require("react");
var import_u_extension_ui = require("@alwith/u-extension-ui");

// src/clock.ts
function describeTime(now, language = "zh-CN") {
  const chinese = language.toLowerCase().startsWith("zh");
  const hour = now.getHours();
  const [icon, chineseMood, englishMood] = hour < 5 ? ["\uD83C\uDF19", "星河值班", "Starlight shift"] : hour < 9 ? ["\uD83C\uDF05", "晨光启程", "Hello, sunrise"] : hour < 12 ? ["☀️", "灵感升温", "Ideas warming up"] : hour < 14 ? ["\uD83C\uDF75", "午间充电", "Midday recharge"] : hour < 18 ? ["☀️", "午后漫游", "Afternoon wander"] : hour < 22 ? ["\uD83C\uDF06", "追上晚风", "Chasing the breeze"] : ["\uD83C\uDF19", "月亮接班", "Moon on duty"];
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const progress = Math.floor((now.getTime() - start.getTime()) / (end.getTime() - start.getTime()) * 100);
  const time = `${String(hour).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const date = new Intl.DateTimeFormat(chinese ? "zh-CN" : "en", { dateStyle: "full" }).format(now);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return {
    time,
    icon,
    mood: chinese ? chineseMood : englishMood,
    progress,
    details: `${date}
${time} · ${zone}`,
    progressLabel: chinese ? `今天已走过 ${progress}%` : `${progress}% of today explored`,
    showTimeLabel: chinese ? "切换到当前时间" : "Show current time",
    showProgressLabel: chinese ? "切换到今日进度" : "Show day progress"
  };
}

// src/main.tsx
var jsx_runtime = require("react/jsx-runtime");
function readLanguage() {
  return document.documentElement.lang || navigator.language;
}
function TimeRoamer() {
  const [language, setLanguage] = import_react2.useState(readLanguage);
  const [now, setNow] = import_react2.useState(() => new Date);
  const [showProgress, setShowProgress] = import_react2.useState(false);
  import_react2.useEffect(() => {
    const observer = new MutationObserver(() => setLanguage(readLanguage()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    setLanguage(readLanguage());
    return () => observer.disconnect();
  }, []);
  import_react2.useEffect(() => {
    let timer;
    const refresh = () => {
      window.clearTimeout(timer);
      const current = new Date;
      setNow(current);
      timer = window.setTimeout(refresh, 60000 - current.getTime() % 60000);
    };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  const clock = describeTime(now, language);
  const label = showProgress ? clock.progressLabel : `${clock.time} · ${clock.mood}`;
  const action = showProgress ? clock.showTimeLabel : clock.showProgressLabel;
  return /* @__PURE__ */ jsx_runtime.jsxs(import_u_extension_ui.Button, {
    variant: "ghost",
    size: "xs",
    className: "alwith-time-roamer",
    title: `${clock.details}
${action}`,
    "aria-label": `${label}. ${action}`,
    "aria-pressed": showProgress,
    onClick: () => setShowProgress((current) => !current),
    children: [
      /* @__PURE__ */ jsx_runtime.jsx("span", {
        "aria-hidden": "true",
        className: "alwith-time-roamer__icon",
        children: clock.icon
      }),
      /* @__PURE__ */ jsx_runtime.jsx("span", {
        className: "alwith-time-roamer__label",
        children: label
      })
    ]
  });
}
var main_default = import_module_extension.defineExtension((context) => ({
  onload() {
    context.view("statusBar", import_react.mountReact({
      id: "clock",
      title: "Time Roamer / 时间漫游",
      icon: "clock",
      alignment: "right",
      render: (mount) => {
        mount.own(import_dom.attachStylesheet(context, "styles.css", mount.container.ownerDocument));
        return /* @__PURE__ */ jsx_runtime.jsx(TimeRoamer, {});
      }
    }));
  }
}));
