import { createReadStream } from "node:fs"
import { mkdtemp, open, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { isAbsolute, join } from "node:path"

import { expect } from "playwright/test"

import { tools } from "./definitions.mjs"
import { createObservations, verify } from "./observation.mjs"

export function createBrowserTools(call, attach, { nativeDownloads = false } = {}) {
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
          const interaction = {
            dialog: null,
            nextDialog: 0,
            operation: null,
            listeners: new Set()
          }
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
          page.on("console", (message) =>
            record({
              type: message.type(),
              text: message.text().slice(0, 4000)
            })
          )
          page.on("pageerror", (error) =>
            record({
              type: "pageerror",
              text: error.message.slice(0, 4000),
              stack: error.stack?.slice(0, 12000)
            })
          )
          page.on("requestfailed", (request) =>
            record({
              type: "requestfailed",
              url: request.url(),
              error: request.failure()?.errorText
            })
          )
          page.on("response", (response) => {
            if (response.status() >= 400)
              record({
                type: "http",
                url: response.url(),
                status: response.status()
              })
          })
          browser.on("disconnected", () => {
            if (connections.get(target) === promise) connections.delete(target)
          })
          return {
            browser,
            page,
            messages,
            frames,
            listFrames,
            interaction,
            observations: createObservations(page)
          }
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
    return {
      id,
      type: dialog.type(),
      message: dialog.message(),
      defaultValue: dialog.defaultValue()
    }
  }
  async function waitForInteraction(state, operation) {
    let notify
    const interrupted = new Promise((resolve) => {
      notify = () =>
        resolve({
          ok: false,
          pending: true,
          dialog: pendingDialog(state.interaction),
          url: state.page.url()
        })
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
    if (name === "browser_release") {
      const pending = connections.get(target)
      if (pending) {
        const { browser } = await pending
        await browser.close()
        connections.delete(target)
      }
      return call({ target, method: "release" })
    }
    if (name === "browser_focus" || name === "browser_close")
      return call({
        target,
        method: name === "browser_focus" ? "focus" : "close"
      })
    if (name === "browser_navigate") {
      const url = new URL(args.url)
      if (!["http:", "https:"].includes(url.protocol)) throw Error("Navigation requires HTTP(S)")
    }
    const definition = tools.find((entry) => entry.name === name)
    const optionalLocator = ["browser_read_page", "browser_snapshot", "browser_screenshot"]
    if (
      definition.inputSchema.properties.selector &&
      !optionalLocator.includes(name) &&
      !(name === "browser_verify" && args.condition === "url") &&
      args.selector === undefined &&
      args.ref === undefined
    )
      throw Error("A locator or snapshot reference is required")
    if (
      args.ref !== undefined &&
      (typeof args.ref !== "string" || !args.ref || typeof args.snapshotId !== "string" || !args.snapshotId)
    )
      throw Error("A ref requires its snapshotId")
    if (args.snapshotId !== undefined && args.ref === undefined) throw Error("snapshotId requires a ref")
    if (args.ref !== undefined && (args.selector !== undefined || args.frame !== undefined))
      throw Error("Use a ref or a selector/frame, not both")
    if (name === "browser_snapshot") {
      if (args.depth !== undefined && (!Number.isInteger(args.depth) || args.depth < 1 || args.depth > 50))
        throw Error("Invalid snapshot depth")
      if (
        args.maxChars !== undefined &&
        (!Number.isInteger(args.maxChars) || args.maxChars < 500 || args.maxChars > 32000)
      )
        throw Error("Invalid snapshot size")
    }
    if (name === "browser_verify") {
      if (!["visible", "hidden", "text", "contains_text", "value", "checked", "count", "url"].includes(args.condition))
        throw Error("Invalid verification condition")
      if (["text", "contains_text", "value", "url"].includes(args.condition) && typeof args.expected !== "string")
        throw Error("Expected a string")
      if (args.condition === "checked" && typeof args.expected !== "boolean") throw Error("Expected a boolean")
      if (args.condition === "count" && (!Number.isSafeInteger(args.expected) || args.expected < 0))
        throw Error("Expected a nonnegative count")
      if (
        args.timeoutMs !== undefined &&
        (!Number.isInteger(args.timeoutMs) || args.timeoutMs < 1 || args.timeoutMs > 20000)
      )
        throw Error("Invalid verification timeout")
    }
    if (name === "browser_visual") {
      if (
        typeof args.imageId !== "string" ||
        !["click", "double_click", "hover", "scroll", "drag", "press", "type"].includes(args.action)
      )
        throw Error("Invalid visual action")
      if (args.action === "type" && typeof args.text !== "string") throw Error("Visual input requires text")
      if (args.action === "press" && (typeof args.key !== "string" || !args.key)) throw Error("Visual key is required")
      if (
        args.action === "scroll" &&
        (!Number.isFinite(args.deltaY) || (args.deltaX !== undefined && !Number.isFinite(args.deltaX)))
      )
        throw Error("Invalid scroll distance")
    }
    if (name === "browser_download" && (typeof args.path !== "string" || !isAbsolute(args.path)))
      throw Error("An absolute download path is required")
    if (name === "browser_type" && typeof args.text !== "string") throw Error("Text must be a string")
    if (name === "browser_type" && args.mode !== undefined && !["fill", "keyboard"].includes(args.mode))
      throw Error("Invalid text input mode")
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
    const { page, messages, frames, listFrames, interaction, observations } = state
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
    if (interaction.dialog)
      return {
        ok: false,
        pending: true,
        dialog: pendingDialog(interaction),
        url: page.url()
      }
    const inventory = listFrames()
    const scope = args.frame === undefined ? page.mainFrame() : frames.get(args.frame)
    if (!scope) throw Error("Frame is detached or unknown; read the page again")
    const locate = (currentScope = scope, input = args) => observations.locate(currentScope, input)
    if (interaction.operation) throw Error("A page action is pending; finish its dialog or wait before continuing")
    if (args.ref && !(name === "browser_verify" && args.condition === "hidden"))
      await observations.validate(scope, args)
    if (name === "browser_snapshot") return observations.snapshot(scope, args, inventory)
    if (name === "browser_resolve")
      return {
        locator: (await locate().normalize()).toString(),
        url: page.url()
      }
    if (name === "browser_screenshot") return observations.screenshot(scope, args, locate)
    if (name === "browser_visual") return perform(state, () => observations.visual(args))
    if (name === "browser_verify")
      return perform(state, () => verify(page, args.condition === "url" ? null : locate(), args))
    if (name === "browser_download")
      return perform(state, async () => {
        // Reserve the destination before clicking: a local conflict must never trigger a second download.
        const destination = await open(args.path, "wx")
        let saved = false
        try {
          if (nativeDownloads) {
            const read = async () => (await call({ target: args.target, method: "downloads" })).downloads
            const before = new Set((await read()).map((item) => item.id))
            await locate().click()
            let completed
            await expect
              .poll(
                async () => {
                  if (disposed) throw Error("Browser tools are closed")
                  const downloads = (await read()).filter((item) => !before.has(item.id))
                  if (downloads.length > 1)
                    throw Error("Multiple downloads started; inspect downloads before continuing")
                  completed = downloads[0]
                  if (completed && ["failed", "canceled"].includes(completed.state))
                    throw Error(`Download ${completed.state}; the action was not repeated`)
                  return completed?.state
                },
                { timeout: 20000, intervals: [50, 100, 250] }
              )
              .toBe("finished")
            await destination.writeFile(createReadStream(completed.path))
            saved = true
            return {
              ok: true,
              path: args.path,
              sourcePath: completed.path,
              bytes: (await stat(args.path)).size
            }
          }
          const [download] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), locate().click()])
          const directory = await mkdtemp(join(tmpdir(), "alwith-download-"))
          try {
            const temporary = join(directory, "download")
            await download.saveAs(temporary)
            await destination.writeFile(createReadStream(temporary))
            saved = true
            return {
              ok: true,
              path: args.path,
              suggestedFilename: download.suggestedFilename(),
              bytes: (await stat(args.path)).size
            }
          } finally {
            await rm(directory, { recursive: true, force: true })
          }
        } finally {
          await destination.close()
          if (!saved) await rm(args.path, { force: true })
        }
      })
    if (name === "browser_inspect")
      return locate().evaluate((element) => {
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
      return perform(state, async () => ({
        result: await scope.evaluate(args.expression)
      }))
    if (name === "browser_wait")
      return perform(state, async () => {
        await locate().waitFor({ state: args.state ?? "visible" })
        return { ok: true, url: page.url() }
      })
    if (name === "browser_read_page") {
      const root = args.ref ? locate() : scope.locator(args.selector ?? "body")
      const offset = args.offset ?? 0
      const limit = args.limit ?? 16000
      const text = await root.innerText()
      const snapshot = await observations.snapshot(scope, { maxChars: 32000 }, inventory, root)
      const accessibility = snapshot.text
      return {
        url: page.url(),
        title: await page.title(),
        fileInputs: await scope.locator('input[type="file"]').evaluateAll((inputs) =>
          inputs.map((input) => ({
            id: input.id,
            name: input.name,
            accept: input.accept,
            multiple: input.multiple
          }))
        ),
        frames: inventory,
        frameUrl: scope.url(),
        accessibility: accessibility.slice(0, 32000),
        accessibilityTruncated: snapshot.truncated,
        snapshotId: snapshot.snapshotId,
        text: text.slice(offset, offset + limit),
        totalLength: text.length,
        nextOffset: offset + limit < text.length ? offset + limit : null
      }
    }
    if (name === "browser_read_elements")
      return locate().evaluateAll(
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
              ? [...element.files].map((file) => ({
                  name: file.name,
                  size: file.size,
                  type: file.type
                }))
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
        const locator = locate()
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
          if (args.mode === "keyboard") {
            await locator.click()
            const editableFocus = await locator.evaluate((element) => {
              const focused = element.ownerDocument.activeElement
              return (
                focused &&
                element.contains(focused) &&
                (focused.isContentEditable ||
                  focused.matches("textarea:not([readonly]):not(:disabled), input:not([readonly]):not(:disabled)"))
              )
            })
            if (!editableFocus) throw Error("Editor did not receive editable focus; inspect the page before typing")
            await page.keyboard.press(args.replace ? "ControlOrMeta+A" : "ControlOrMeta+End")
            await page.keyboard.insertText(args.text)
            return {
              ok: true,
              url: page.url(),
              outcome: "action-dispatched",
              verificationRequired: true
            }
          }
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
      return {
        ok: true,
        url: page.url(),
        outcome: "action-dispatched",
        verificationRequired: true
      }
    })
  }
  const busy = new Map()
  const stopping = new Set()
  const guarded = async (name, args = {}) => {
    const target = args.target
    if (target && (busy.has(target) || stopping.has(target)))
      throw Error("Target is busy; await its current tool call before continuing")
    const operation = Promise.resolve().then(() => run(name, args))
    if (target) busy.set(target, operation)
    try {
      return await operation
    } finally {
      if (target) busy.delete(target)
    }
  }
  // Disconnect only active operations. Idle transport and page state survive handoff.
  guarded.release = async (target) => {
    stopping.add(target)
    try {
      const pending = connections.get(target)
      const state = pending ? await pending.catch(() => null) : null
      const operation = busy.get(target)
      const interaction = state?.interaction.operation
      if (state && (operation || interaction || state.interaction.dialog)) {
        await state.browser.close()
        connections.delete(target)
      }
      await Promise.allSettled([operation, interaction])
      state?.observations.invalidate()
      if (state) state.messages.length = 0
      return { disconnected: !!state && !connections.has(target) }
    } finally {
      stopping.delete(target)
    }
  }
  guarded.close = async () => {
    disposed = true
    await Promise.allSettled([...connections.values()].map(async (pending) => (await pending).browser.close()))
    connections.clear()
  }
  return guarded
}
