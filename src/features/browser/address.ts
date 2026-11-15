import i18n from "i18next"

/** The browser's own page that lists installed extensions; the one internal page a tab may show. */
export const extensionsPage = "chrome://extensions/"
/** What precedes the address of a page whose source is shown instead of the page. */
export const sourcePrefix = "view-source:"
/** Where extensions are installed from. */
export const extensionStore = "https://chromewebstore.google.com/category/extensions"

/** Resolve user input without coupling browser navigation to a desktop host. */
export function resolveAddress(input: string, search = "https://www.google.com/search?q="): string {
  const value = input.trim()
  if (!value) return "about:blank"
  if (value === "about:blank") return value
  if (/^view-source:https?:\/\//i.test(value))
    return sourcePrefix + resolveAddress(value.slice(sourcePrefix.length), search)
  if (/^chrome:\/\/extensions\/?$/i.test(value)) return extensionsPage
  if (/^https?:\/\//i.test(value)) {
    const parsed = new URL(value)
    if (parsed.username || parsed.password) throw new Error(i18n.t("browser.noCredentialsInAddress"))
    return value
  }
  const local = /^(localhost|[\w-]+\.localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])(?=[:/?#]|$)/i.test(value)
  const host = /^(?:[^\s./:]+\.)+[^\s./:]+(?::\d+)?(?:[/?#].*)?$/u.test(value)
  if (!/\s/.test(value) && (local || host)) {
    const parsed = new URL(`${local ? "http" : "https"}://${value}`)
    if (parsed.username || parsed.password) throw new Error(i18n.t("browser.noCredentialsInAddress"))
    return parsed.href
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) throw new Error(i18n.t("browser.webOnly"))
  return `${search}${encodeURIComponent(value)}`
}

/** Where a web page is shown translated into `language`: the page is fetched and rewritten by the translation service. */
export function translationOf(url: string, language: string): string {
  return `https://translate.google.com/translate?sl=auto&tl=${encodeURIComponent(language)}&u=${encodeURIComponent(url)}`
}
