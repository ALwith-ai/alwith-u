// Runs in a world of its own in every document of a tab of the user's. The page's scripts see
// neither this code nor the binding it reports through; it sees the page's fields.
;(() => {
  // A login is offered and taken in the page the user is on and in frames of that same website,
  // never in a frame of another one: the address the user sees does not name it.
  const own = () => {
    try {
      return top.location.origin === location.origin
    } catch {
      return false
    }
  }
  if (!own() || !/^https?:$/.test(location.protocol)) return
  const tell = (message) => globalThis.__alwithLogin(JSON.stringify({ ...message, origin: location.origin }))
  const shown = (field) => {
    const box = field.getBoundingClientRect()
    return box.width > 0 && box.height > 0 && getComputedStyle(field).visibility !== "hidden"
  }
  const passwords = (scope) => [...(scope ?? document).querySelectorAll("input[type=password]")].filter(shown)
  const named = (field) => ["text", "email", "tel", "url"].includes(field.type) && shown(field)
  // The field that names the account: the last one a user types a name into before the password.
  const nameBefore = (password) => {
    let found
    for (const field of (password.form ?? document).querySelectorAll("input"))
      if (named(field) && field.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING) found = field
    return found
  }
  const write = (field, value) => {
    // Through the element's own setter, with the events a framework listens for.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(field, value)
    field.dispatchEvent(new Event("input", { bubbles: true }))
    field.dispatchEvent(new Event("change", { bubbles: true }))
  }
  // Called by the application with a saved login. What the user already typed is kept unless they asked.
  globalThis.__alwithFill = ({ username, password, replace }) => {
    const fields = passwords()
    // A form that asks for a new password, or for one twice, makes an account: nothing kept belongs in it unasked.
    if (!replace && (fields.length !== 1 || fields[0].autocomplete === "new-password")) return false
    const field = fields.find((candidate) => replace || !candidate.value)
    if (!field) return false
    const name = nameBefore(field)
    if (name && username && (replace || !name.value)) write(name, username)
    write(field, password)
    return true
  }
  // Called by the application with a password it made, for a form that asks for a new one, twice or not.
  globalThis.__alwithSuggest = (password) => {
    const fields = passwords().filter((candidate) => !candidate.value)
    for (const field of fields) write(field, password)
    return fields.length > 0
  }
  // Asked by the application a while after a sign-in: a form still asking for the password was not satisfied.
  globalThis.__alwithAsking = () => passwords().length > 0
  let announced = false
  const announce = () => {
    if (announced || passwords().length === 0) return
    announced = true
    tell({ kind: "fields" })
  }
  let reported = ""
  const report = (scope) => {
    const field = passwords(scope).find((candidate) => candidate.value)
    if (field) {
      const username = nameBefore(field)?.value ?? ""
      const key = `${username}\n${field.value}`
      if (key === reported) return
      reported = key
      tell({ kind: "submit", username, password: field.value })
      return
    }
    // A sign-in that asks for the name on one page and the password on the next.
    const name = [...(scope ?? document).querySelectorAll("input")].find((candidate) => named(candidate) && candidate.value)
    if (name && passwords().length === 0) tell({ kind: "name", username: name.value })
  }
  addEventListener("submit", (event) => report(event.target), true)
  addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Enter" && event.target instanceof HTMLInputElement) report(event.target.form ?? document)
    },
    true
  )
  addEventListener(
    "click",
    (event) => {
      const button = event.target instanceof Element && event.target.closest("button, input[type=submit], [role=button]")
      if (button) report(button.form ?? document)
    },
    true
  )
  new MutationObserver(announce).observe(document, { childList: true, subtree: true })
  addEventListener("DOMContentLoaded", announce)
  announce()
})()
