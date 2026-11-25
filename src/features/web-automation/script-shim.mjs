/**
 * Loaded before a script that runs under the conversation's sandbox. A browser cannot be started there, so
 * every way a script starts or reaches a Chromium browser gives it the conversation's tab in the built-in
 * browser. The runner makes every Playwright package name resolve to the copy shipped beside this file, which
 * is the copy changed here.
 */
import { createRequire } from "node:module"

const playwright = createRequire(import.meta.url)("playwright-core")
const endpoint = process.env.U_BROWSER_CDP
if (!endpoint) throw Error("This script must be started by the browser_run tool")
const connect = playwright.chromium.connectOverCDP.bind(playwright.chromium)
let connecting
const tab = () =>
  (connecting ??= connect(endpoint, { noDefaults: true }).then((browser) => {
    const pages = browser.contexts().flatMap((context) => context.pages())
    if (pages.length !== 1) throw Error("Expected exactly one authorized tab")
    return { browser, page: pages[0] }
  }))
const override = (target, methods) =>
  new Proxy(target, {
    get(object, key) {
      if (Object.hasOwn(methods, key)) return methods[key]
      const value = Reflect.get(object, key)
      return typeof value === "function" ? value.bind(object) : value
    }
  })
// The tab outlives the script: closing a page or a context leaves it open, and closing the browser lets go of it.
const pageOf = (page) => override(page, { close: async () => {} })
async function contextOf(options = {}) {
  const { browser, page } = await tab()
  const context = override(page.context(), {
    close: async () => {},
    browser: () => browserOf(browser),
    pages: () => [pageOf(page)],
    // There is one tab, so a new page is that tab again with the context's viewport. It keeps the document
    // it shows: the built-in browser navigates to websites only, so it cannot be made blank.
    newPage: async () => {
      if (options.viewport) await page.setViewportSize(options.viewport)
      return pageOf(page)
    }
  })
  return context
}
const browserOf = (browser) =>
  override(browser, {
    close: () => browser.close(),
    contexts: () => [],
    newContext: contextOf,
    newPage: async (options) => (await contextOf(options)).newPage()
  })
const browser = async () => browserOf((await tab()).browser)
Object.assign(playwright.chromium, {
  launch: browser,
  connect: browser,
  connectOverCDP: browser,
  launchPersistentContext: (_directory, options) => contextOf(options)
})
const unavailable = (name) => async () => {
  throw Error(`${name} is not available here: scripts run in the built-in Chromium browser`)
}
for (const name of ["firefox", "webkit"])
  Object.assign(playwright[name], {
    launch: unavailable(name),
    connect: unavailable(name),
    launchPersistentContext: unavailable(name)
  })
