/* global chrome */
// What the browser told the extension about tabs, for the contract to read back.
const events = []
for (const name of ["onCreated", "onUpdated", "onRemoved", "onActivated", "onMoved"])
  chrome.tabs[name].addListener((...details) => events.push([name, ...details]))
chrome.windows.onFocusChanged.addListener((id) => events.push(["onFocusChanged", id]))
chrome.contextMenus.onClicked.addListener((info) => events.push(["onClicked", info]))
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  // Any extension API, called as the extension, so the contract can ask what an extension would.
  if (message.call) {
    const [namespace, method] = message.call.split(".")
    Promise.resolve()
      .then(() => chrome[namespace][method](...message.args))
      .then(
        (value) => reply({ value: value ?? null }),
        (error) => reply({ error: error.message })
      )
    return true
  }
  if (message === "events") {
    reply({ value: events })
    return false
  }
  // Its popup reports the tab it found itself over; a page asks what that was.
  if (message.popup) {
    chrome.storage.local.set({ popupTab: message.popup }).then(() => reply("noted"))
    return true
  }
  if (message === "close-popup") {
    chrome.storage.local.set({ closePopup: Date.now() }).then(() => reply("asked"))
    return true
  }
  if (message === "popup-tab") {
    chrome.storage.local.get("popupTab").then(({ popupTab }) => reply(popupTab ?? "never opened"))
    return true
  }
  // A page the extension opens for itself, the way a welcome or help page is.
  if (message.open) {
    chrome.windows.create({ url: message.open }).then(
      () => reply("opened"),
      (error) => reply(`error: ${error.message}`)
    )
    return true
  }
  ;(async () => {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [1],
      addRules: [
        {
          id: 1,
          action: { type: "block" },
          condition: { urlFilter: "/blocked-by-extension", resourceTypes: ["xmlhttprequest"] }
        }
      ]
    })
    await chrome.storage.local.set({ seen: sender.tab.id })
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: sender.tab.id },
      func: () => document.title
    })
    reply(`ready: ${result}`)
  })().catch((error) => reply(`error: ${error.message}`))
  return true
})
