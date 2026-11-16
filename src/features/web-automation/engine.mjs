import { stat } from "node:fs/promises"
import { isAbsolute } from "node:path"

import { tools } from "./definitions.mjs"

export function createBrowserTools(call, attach) {
  const connections = new Map()
  let disposed = false
  async function pageFor(target) {
    if (disposed) throw Error("Browser tools are closed")
    if (!attach) throw Error("Playwright connection is unavailable")
    if (!connections.has(target)) {
      const promise = attach(target)
        .then(async (browser) => {
          if (disposed) {
            await browser.close()
            throw Error("Browser tools are closed")
          }
          const pages = browser.contexts().flatMap((context) => context.pages())
          if (pages.length !== 1) {
            await browser.close()
            throw Error("Expected exactly one authorized guest")
          }
          const page = pages[0]
          page.setDefaultTimeout(10000)
          page.setDefaultNavigationTimeout(20000)
          const messages = []
          const interaction = { dialog: null, nextDialog: 0, operation: null, listeners: new Set() }
          page.on("dialog", (dialog) => {
            interaction.dialog = { dialog, id: ++interaction.nextDialog }
            for (const notify of interaction.listeners) notify()
          })
          const frames = new Map()
          let nextFrame = 0
          const frameIds = new WeakMap()
          const listFrames = () => {
            frames.clear()
            return page.frames().map((current) => {
              const id = (value) => {
                if (!frameIds.has(value)) frameIds.set(value, `frame-${++nextFrame}`)
                return frameIds.get(value)
              }
              const key = id(current)
              frames.set(key, current)
              return {
                id: key,
                url: current.url(),
                name: current.name(),
                parent: current.parentFrame() ? id(current.parentFrame()) : null
              }
            })
          }
          const record = (value) => {
            messages.push(value)
            if (messages.length > 100) messages.shift()
          }
          page.on("console", (message) => record({ type: message.type(), text: message.text().slice(0, 4000) }))
          page.on("pageerror", (error) =>
            record({ type: "pageerror", text: error.message.slice(0, 4000), stack: error.stack?.slice(0, 12000) })
          )
          page.on("requestfailed", (request) =>
            record({ type: "requestfailed", url: request.url(), error: request.failure()?.errorText })
          )
          page.on("response", (response) => {
            if (response.status() >= 400) record({ type: "http", url: response.url(), status: response.status() })
          })
          browser.on("disconnected", () => {
            if (connections.get(target) === promise) connections.delete(target)
          })
          return { browser, page, messages, frames, listFrames, interaction }
        })
        .catch((error) => {
          connections.delete(target)
          throw error
        })
      connections.set(target, promise)
    }
    return connections.get(target)
  }
  const pendingDialog = (interaction) => {
    const { dialog, id } = interaction.dialog
    return { id, type: dialog.type(), message: dialog.message(), defaultValue: dialog.defaultValue() }
  }
  async function waitForInteraction(state, operation) {
    let notify
    const interrupted = new Promise((resolve) => {
      notify = () =>
        resolve({ ok: false, pending: true, dialog: pendingDialog(state.interaction), url: state.page.url() })
    })
    state.interaction.listeners.add(notify)
    try {
      if (state.interaction.dialog) notify()
      return await Promise.race([operation, interrupted])
    } finally {
      state.interaction.listeners.delete(notify)
    }
  }
  async function perform(state, action) {
    if (state.interaction.operation)
      throw Error("A page action is still pending; inspect and handle its dialog before continuing")
    const operation = Promise.resolve().then(action)
    state.interaction.operation = operation
    const clear = () => {
      if (state.interaction.operation === operation) state.interaction.operation = null
    }
    operation.then(clear, clear)
    return waitForInteraction(state, operation)
  }
  const run = async (name, args = {}) => {
    if (disposed) throw Error("Browser tools are closed")
    if (name === "browser_open") {
      const url = new URL(args.url)
      if (!["http:", "https:"].includes(url.protocol)) throw Error("Preview requires HTTP(S)")
      return call({ method: "open", params: { url: url.href } })
    }
    if (name === "browser_list") return call({ method: "list" })
    if (!tools.some((tool) => tool.name === name)) throw Error("Unknown browser tool")
    if (typeof args.target !== "string" || !args.target) throw Error("An explicit guest target is required")
    const target = args.target
    if (name === "browser_focus" || name === "browser_close")
      return call({ target, method: name === "browser_focus" ? "focus" : "close" })
    if (name === "browser_navigate") {
      const url = new URL(args.url)
      if (!["http:", "https:"].includes(url.protocol)) throw Error("Navigation requires HTTP(S)")
    }
    if (
      tools.find((entry) => entry.name === name).inputSchema.required.includes("selector") &&
      (typeof args.selector !== "string" || !args.selector)
    )
      throw Error("A locator is required")
    if (name === "browser_type" && typeof args.text !== "string") throw Error("Text must be a string")
    if (name === "browser_evaluate" && (typeof args.expression !== "string" || !args.expression.trim()))
      throw Error("An expression is required")
    if (
      name === "browser_wait" &&
      args.state !== undefined &&
      !["visible", "hidden", "attached", "detached"].includes(args.state)
    )
      throw Error("Invalid wait state")
    if (args.frame !== undefined && (typeof args.frame !== "string" || !args.frame)) throw Error("Invalid frame id")
    if (args.selector !== undefined && (typeof args.selector !== "string" || !args.selector))
      throw Error("Invalid locator")
    if (["browser_read_page", "browser_read_elements"].includes(name)) {
      if (args.offset !== undefined && (!Number.isSafeInteger(args.offset) || args.offset < 0))
        throw Error("Invalid read offset")
      const maximum = name === "browser_read_page" ? 32000 : 100
      if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > maximum))
        throw Error("Invalid read limit")
    }
    if (name === "browser_check" && typeof args.checked !== "boolean") throw Error("checked must be a boolean")
    if (name === "browser_drag" && (typeof args.destination !== "string" || !args.destination))
      throw Error("A destination locator is required")
    if (name === "browser_scroll" && (!Number.isFinite(args.y) || (args.x !== undefined && !Number.isFinite(args.x))))
      throw Error("Scroll distances must be finite numbers")
    if (name === "browser_upload") {
      if (
        !Array.isArray(args.paths) ||
        args.paths.length > 100 ||
        args.paths.some((path) => typeof path !== "string" || !isAbsolute(path))
      )
        throw Error("File paths must be an array of absolute paths")
      for (const path of args.paths) if (!(await stat(path)).isFile()) throw Error(`Not a file: ${path}`)
    }
    const state = await pageFor(target)
    const { page, messages, frames, listFrames, interaction } = state
    if (name === "browser_dialog") {
      if (
        !Number.isInteger(args.id) ||
        typeof args.accept !== "boolean" ||
        (args.promptText !== undefined && typeof args.promptText !== "string")
      )
        throw Error("Invalid dialog response")
      if (!interaction.dialog || interaction.dialog.id !== args.id)
        throw Error("Dialog is no longer current; inspect the page again")
      const { dialog } = interaction.dialog
      const operation = interaction.operation
      interaction.dialog = null
      try {
        if (args.accept) await dialog.accept(args.promptText)
        else await dialog.dismiss()
      } catch (error) {
        throw Error(`Dialog response failed; inspect the page before retrying: ${error}`, { cause: error })
      }
      return waitForInteraction(state, operation ?? Promise.resolve({ ok: true, url: page.url() }))
    }
    if (interaction.dialog) return { ok: false, pending: true, dialog: pendingDialog(interaction), url: page.url() }
    const inventory = listFrames()
    const scope = args.frame === undefined ? page.mainFrame() : frames.get(args.frame)
    if (!scope) throw Error("Frame is detached or unknown; read the page again")
    if (name === "browser_inspect")
      return scope.locator(args.selector).evaluate((element) => {
        const rect = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        return {
          html: element.outerHTML.slice(0, 8000),
          box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          styles: Object.fromEntries(
            [
              "display",
              "position",
              "width",
              "height",
              "overflow",
              "color",
              "background-color",
              "font-size",
              "margin",
              "padding"
            ].map((key) => [key, style.getPropertyValue(key)])
          ),
          stylesheets: [...document.styleSheets].map((sheet) => sheet.href).filter(Boolean)
        }
      })
    if (name === "browser_evaluate")
      return perform(state, async () => ({ result: await scope.evaluate(args.expression) }))
    if (name === "browser_wait")
      return perform(state, async () => {
        await scope.locator(args.selector).waitFor({ state: args.state ?? "visible" })
        return { ok: true, url: page.url() }
      })
    if (name === "browser_read_page") {
      const root = scope.locator(args.selector ?? "body")
      const offset = args.offset ?? 0
      const limit = args.limit ?? 16000
      const text = await root.innerText()
      const accessibility = await root.ariaSnapshot()
      return {
        url: page.url(),
        title: await page.title(),
        fileInputs: await scope
          .locator('input[type="file"]')
          .evaluateAll((inputs) =>
            inputs.map((input) => ({ id: input.id, name: input.name, accept: input.accept, multiple: input.multiple }))
          ),
        frames: inventory,
        frameUrl: scope.url(),
        accessibility: accessibility.slice(0, 32000),
        accessibilityTruncated: accessibility.length > 32000,
        text: text.slice(offset, offset + limit),
        totalLength: text.length,
        nextOffset: offset + limit < text.length ? offset + limit : null
      }
    }
    if (name === "browser_read_elements")
      return scope.locator(args.selector).evaluateAll(
        (elements, { offset, limit }) => ({
          total: elements.length,
          nextOffset: offset + limit < elements.length ? offset + limit : null,
          elements: elements.slice(offset, offset + limit).map((element, index) => ({
            index: offset + index,
            tag: element.tagName.toLowerCase(),
            role: element.getAttribute("role"),
            name: element.getAttribute("aria-label"),
            text: (element.innerText ?? element.textContent ?? "").slice(0, 4000),
            value: element.type === "password" ? undefined : element.value,
            checked: element.checked ?? element.getAttribute("aria-checked"),
            disabled: element.matches(":disabled") || element.getAttribute("aria-disabled") === "true",
            href: element.getAttribute("href"),
            type: element.getAttribute("type"),
            files: element.files
              ? [...element.files].map((file) => ({ name: file.name, size: file.size, type: file.type }))
              : undefined
          }))
        }),
        { offset: args.offset ?? 0, limit: args.limit ?? 50 }
      )
    if (name === "browser_diagnostics") return { url: page.url(), messages: [...messages] }
    if (name === "browser_cdp") {
      if (
        typeof args.method !== "string" ||
        (args.params !== undefined && (!args.params || typeof args.params !== "object" || Array.isArray(args.params)))
      )
        throw Error("Invalid CDP command")
      // Use the existing scoped native route; no additional debugger attachment.
      return call({ target, method: args.method, params: args.params ?? {} })
    }
    return perform(state, async () => {
      if (name === "browser_navigate") await page.goto(args.url, { waitUntil: "domcontentloaded" })
      else if (name === "browser_reload") await page.reload({ waitUntil: "domcontentloaded" })
      else if (name === "browser_back") await page.goBack({ waitUntil: "commit" })
      else if (name === "browser_forward") await page.goForward({ waitUntil: "commit" })
      else {
        const locator = scope.locator(args.selector)
        if (name === "browser_click") await locator.click()
        else if (name === "browser_hover") await locator.hover()
        else if (name === "browser_double_click") await locator.dblclick()
        else if (name === "browser_check") await locator.setChecked(args.checked)
        else if (name === "browser_drag") {
          const destination = scope.locator(args.destination)
          // Settle destination scrolling before pressing the source; scrolling mid-drag can cancel native dragstart.
          await destination.scrollIntoViewIfNeeded()
          await locator.dragTo(destination, { steps: 8 })
        } else if (name === "browser_upload") await locator.setInputFiles(args.paths)
        else if (name === "browser_scroll")
          return locator.evaluate(
            (element, { x, y }) => {
              const scroller =
                element === document.body || element === document.documentElement ? document.scrollingElement : element
              if (!scroller) throw Error("Document has no scrolling element")
              scroller.scrollBy({ left: x, top: y, behavior: "instant" })
              return {
                ok: true,
                x: scroller.scrollLeft,
                y: scroller.scrollTop,
                width: scroller.scrollWidth,
                height: scroller.scrollHeight,
                viewportHeight: scroller.clientHeight
              }
            },
            { x: args.x ?? 0, y: args.y }
          )
        else if (name === "browser_type") {
          // Activate the editor through its normal interaction path before entering text.
          // Rich editors can initialize editing on pointer activation rather than DOM focus.
          await locator.click()
          if (args.replace) await locator.fill(args.text)
          else {
            await locator.focus()
            await locator.press("ControlOrMeta+End")
            await locator.pressSequentially(args.text)
          }
          const observed = await locator.evaluate((element) => ({
            value: "value" in element ? element.value : element.innerText,
            sensitive: element.type === "password"
          }))
          const matchesRequestedText = args.replace
            ? observed.value.replaceAll("\r\n", "\n") === args.text.replaceAll("\r\n", "\n")
            : undefined
          return {
            ok: matchesRequestedText !== false,
            url: page.url(),
            matchesRequestedText,
            value: observed.sensitive ? undefined : observed.value
          }
        } else if (name === "browser_press") await locator.press(args.key)
        else if (name === "browser_select") await locator.selectOption(args.value)
      }
      return { ok: true, url: page.url() }
    })
  }
  run.close = async () => {
    disposed = true
    await Promise.allSettled([...connections.values()].map(async (pending) => (await pending).browser.close()))
    connections.clear()
  }
  return run
}

