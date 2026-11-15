/* global chrome */
// Marks every document this extension reaches, and asks its worker to act on the tab.
document.documentElement.dataset.contractExtension = chrome.runtime.id
chrome.runtime.sendMessage("act").then(
  (reply) => (document.documentElement.dataset.contractWorker = reply),
  (error) => (document.documentElement.dataset.contractWorker = `error: ${error.message}`)
)
// The contract asks through the page, since only an extension can call its own worker.
addEventListener("contract-open", (event) => {
  chrome.runtime.sendMessage({ open: event.detail }).then(
    (reply) => (document.documentElement.dataset.contractOpened = reply),
    (error) => (document.documentElement.dataset.contractOpened = `error: ${error.message}`)
  )
})
addEventListener("contract-close-popup", () => void chrome.runtime.sendMessage("close-popup"))
addEventListener("contract-popup-tab", () => {
  chrome.runtime.sendMessage("popup-tab").then(
    (reply) => (document.documentElement.dataset.contractPopupTab = reply),
    (error) => (document.documentElement.dataset.contractPopupTab = `error: ${error.message}`)
  )
})
addEventListener("contract-call", (event) => {
  const { id, ...message } = event.detail
  chrome.runtime.sendMessage(message.call === "events" ? "events" : message).then(
    (reply) => (document.documentElement.dataset.contractReply = JSON.stringify({ id, ...reply })),
    (error) => (document.documentElement.dataset.contractReply = JSON.stringify({ id, error: error.message }))
  )
})
