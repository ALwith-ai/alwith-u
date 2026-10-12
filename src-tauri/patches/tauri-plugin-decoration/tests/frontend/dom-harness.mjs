import vm from "node:vm";

class HarnessEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.defaultPrevented = false;
    Object.assign(this, init);
  }

  preventDefault() {
    this.defaultPrevented = true;
  }
}

class HarnessEventTarget {
  constructor() {
    this._listeners = new Map();
  }

  addEventListener(type, listener, options = {}) {
    const listeners = this._listeners.get(type) ?? [];
    listeners.push({ listener, once: options === true ? false : Boolean(options.once) });
    this._listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    const listeners = this._listeners.get(type) ?? [];
    this._listeners.set(
      type,
      listeners.filter((entry) => entry.listener !== listener),
    );
  }

  dispatchEvent(event) {
    event.target ??= this;
    event.currentTarget = this;
    const listeners = [...(this._listeners.get(event.type) ?? [])];
    for (const entry of listeners) {
      entry.listener.call(this, event);
      if (entry.once) this.removeEventListener(event.type, entry.listener);
    }
    const handler = this[`on${event.type}`];
    if (typeof handler === "function") handler.call(this, event);
    return !event.defaultPrevented;
  }
}

class HarnessClassList {
  #element;
  #values = new Set();

  constructor(element) {
    this.#element = element;
  }

  add(...values) {
    values.forEach((value) => this.#values.add(value));
    this.#sync();
  }

  remove(...values) {
    values.forEach((value) => this.#values.delete(value));
    this.#sync();
  }

  contains(value) {
    return this.#values.has(value);
  }

  replaceFrom(value) {
    this.#values = new Set(String(value).split(/\s+/).filter(Boolean));
  }

  toString() {
    return [...this.#values].join(" ");
  }

  #sync() {
    this.#element._setClassAttribute(this.toString());
  }
}

class HarnessStyle {
  #properties = new Map();

  setProperty(name, value, priority = "") {
    this.#properties.set(String(name), {
      priority: String(priority),
      value: String(value),
    });
  }

  getPropertyValue(name) {
    return this.#properties.get(String(name))?.value ?? "";
  }

  getPropertyPriority(name) {
    return this.#properties.get(String(name))?.priority ?? "";
  }

  removeProperty(name) {
    const property = String(name);
    const previous = this.getPropertyValue(property);
    this.#properties.delete(property);
    return previous;
  }

  get length() {
    return this.#properties.size;
  }

  item(index) {
    return [...this.#properties.keys()][index] ?? "";
  }
}

function selectorMatches(element, selector) {
  const trimmed = selector.trim();
  const tag = trimmed.match(/^[a-zA-Z][\w-]*/)?.[0];
  if (tag && element.tagName !== tag.toUpperCase()) return false;

  const id = trimmed.match(/#([\w-]+)/)?.[1];
  if (id && element.id !== id) return false;

  const classNames = [...trimmed.matchAll(/\.([\w-]+)/g)].map((match) => match[1]);
  if (classNames.some((className) => !element.classList.contains(className))) return false;

  const attributes = [...trimmed.matchAll(/\[([^\]^=\s]+)(?:(\^?=)["']([^"']*)["'])?\]/g)];
  for (const [, name, operator, value] of attributes) {
    if (!element.hasAttribute(name)) return false;
    if (operator === "=" && element.getAttribute(name) !== value) return false;
    if (operator === "^=" && !element.getAttribute(name).startsWith(value)) return false;
  }
  return true;
}

class HarnessElement extends HarnessEventTarget {
  constructor(tagName, ownerDocument) {
    super();
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.children = [];
    this.attributes = new Map();
    this.classList = new HarnessClassList(this);
    this.style = new HarnessStyle();
    this.textContent = "";
    this._boundingClientRect = null;
  }

  get className() {
    return this.classList.toString();
  }

  set className(value) {
    this.classList.replaceFrom(value);
    this._setClassAttribute(this.classList.toString());
  }

  get id() {
    return this.getAttribute("id") ?? "";
  }

  set id(value) {
    this.setAttribute("id", value);
  }

  get href() {
    return this.getAttribute("href") ?? "";
  }

  set href(value) {
    this.setAttribute("href", value);
  }

  getBoundingClientRect() {
    if (this._boundingClientRect) {
      const rectangle = { ...this._boundingClientRect };
      rectangle.right ??= rectangle.left + rectangle.width;
      rectangle.bottom ??= rectangle.top + rectangle.height;
      rectangle.x ??= rectangle.left;
      rectangle.y ??= rectangle.top;
      return rectangle;
    }
    if (this.hasAttribute("data-tauri-plugin-decoration-root")) {
      return {
        bottom: 32,
        height: 32,
        left: 0,
        right: 800,
        top: 0,
        width: 800,
        x: 0,
        y: 0,
      };
    }
    const control = this.getAttribute("data-tauri-decoration-control");
    const controlHost = this.hasAttribute("data-tauri-decoration-controls");
    const platform = controlHost
      ? this.getAttribute("data-tauri-decoration-platform")
      : this.parentNode?.getAttribute?.("data-tauri-decoration-platform");
    const controls = this.parentNode?.children?.filter?.((child) =>
      child.hasAttribute("data-tauri-decoration-control"),
    );
    const hostControls = controlHost
      ? this.children.filter((child) =>
          child.hasAttribute("data-tauri-decoration-control"),
        )
      : controls;
    const index = controls?.indexOf(this) ?? 0;
    const count = hostControls?.length ?? 0;
    const controlWidth = platform === "linux" ? 32 : 58;
    const hostWidth =
      platform === "linux"
        ? count === 0
          ? 0
          : count * controlWidth + (count - 1) * 6 + 16
        : count * controlWidth;
    const width = control ? controlWidth : controlHost ? hostWidth : 0;
    const side = controlHost
      ? this.getAttribute("data-tauri-decoration-side")
      : this.parentNode?.getAttribute?.("data-tauri-decoration-side");
    const hostLeft = side === "left" ? 0 : 800 - hostWidth;
    const left = control
      ? hostLeft + index * controlWidth
      : controlHost
        ? hostLeft
        : 0;
    return {
      bottom: control || controlHost ? 32 : 0,
      height: control || controlHost ? 32 : 0,
      left,
      right: left + width,
      top: 0,
      width,
      x: left,
      y: 0,
    };
  }

  get src() {
    return this.getAttribute("src") ?? "";
  }

  set src(value) {
    this.setAttribute("src", value);
  }

  get firstChild() {
    return this.children[0] ?? null;
  }

  get isConnected() {
    let current = this;
    while (current) {
      if (current === this.ownerDocument.documentElement) return true;
      current = current.parentNode;
    }
    return false;
  }

  setAttribute(name, value) {
    const normalized = String(value);
    this.attributes.set(name, normalized);
    if (name === "class") this.classList.replaceFrom(normalized);
  }

  _setClassAttribute(value) {
    if (value) this.attributes.set("class", value);
    else this.attributes.delete("class");
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === "class") this.classList.replaceFrom("");
  }

  appendChild(child) {
    child.remove();
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  prepend(child) {
    child.remove();
    child.parentNode = this;
    this.children.unshift(child);
  }

  replaceChildren(...children) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    children.forEach((child) => this.appendChild(child));
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (element) => {
      for (const child of element.children) {
        if (selectorMatches(child, selector)) matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches;
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (selectorMatches(current, selector)) return current;
      current = current.parentNode;
    }
    return null;
  }

  blur() {}
}

class HarnessDocument extends HarnessEventTarget {
  constructor() {
    super();
    this.readyState = "complete";
    this.documentElement = new HarnessElement("html", this);
    this.head = new HarnessElement("head", this);
    this.body = new HarnessElement("body", this);
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this.pointElement = null;
  }

  createElement(tagName) {
    return new HarnessElement(tagName, this);
  }

  querySelector(selector) {
    if (selectorMatches(this.documentElement, selector)) return this.documentElement;
    return this.documentElement.querySelector(selector);
  }

  querySelectorAll(selector) {
    const matches = selectorMatches(this.documentElement, selector)
      ? [this.documentElement]
      : [];
    return matches.concat(this.documentElement.querySelectorAll(selector));
  }

  elementFromPoint() {
    return this.pointElement;
  }
}

class HarnessMutationObserver {
  constructor(callback) {
    this.callback = callback;
  }

  observe() {}

  disconnect() {}
}

class HarnessResizeObserver {
  constructor(callback) {
    this.callback = callback;
    this.targets = new Set();
  }

  observe(target) {
    this.targets.add(target);
    target.ownerDocument.defaultView._resizeObservers.add(this);
  }

  disconnect() {
    this.targets.clear();
  }
}

export function spy(implementation = () => undefined) {
  const fn = (...args) => {
    fn.calls.push(args);
    const current = fn.implementations.shift() ?? fn.implementation;
    return current(...args);
  };
  fn.calls = [];
  fn.implementation = implementation;
  fn.implementations = [];
  fn.mockClear = () => {
    fn.calls.length = 0;
  };
  fn.mockImplementationOnce = (next) => {
    fn.implementations.push(next);
    return fn;
  };
  return fn;
}

export function createDomWindow(options = {}) {
  const document = new HarnessDocument();
  const media = new HarnessEventTarget();
  media.matches = false;
  const window = new HarnessEventTarget();
  Object.assign(window, {
    AbortController,
    Array,
    Boolean,
    console,
    crypto: {
      getRandomValues(values) {
        for (let index = 0; index < values.length; index += 1) {
          values[index] = index + 1;
        }
        return values;
      },
    },
    clearTimeout: options.clearTimeoutImpl ?? clearTimeout,
    devicePixelRatio: 1,
    document,
    Error,
    Event: HarnessEvent,
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    JSON,
    Map,
    matchMedia: () => media,
    Math,
    MutationObserver: HarnessMutationObserver,
    Number,
    Object,
    Promise,
    queueMicrotask,
    requestAnimationFrame: (callback) => queueMicrotask(() => callback(Date.now())),
    ResizeObserver: HarnessResizeObserver,
    Set,
    setTimeout: options.setTimeoutImpl ?? setTimeout,
    String,
  });
  window._resizeObservers = new Set();
  window.flushResizeObservers = () => {
    for (const observer of window._resizeObservers) {
      observer.callback(
        [...observer.targets].map((target) => ({ target })),
        observer,
      );
    }
  };
  window.window = window;
  window.self = window;
  window.top = window;
  window.globalThis = window;
  window.location = {
    hostname: "tauri.localhost",
    protocol: "https:",
  };
  document.defaultView = window;
  const context = vm.createContext(window);
  window.eval = (source) => vm.runInContext(source, context);
  return window;
}
