/* global chrome */
// What every popup does first: ask which tab it was opened over. It closes itself when told to.
chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
  const found = tab?.url ?? "no tab"
  document.querySelector("#tab").textContent = found
  await chrome.runtime.sendMessage({ popup: found })
})
chrome.storage.onChanged.addListener((changes) => {
  if (changes.closePopup) window.close()
})
