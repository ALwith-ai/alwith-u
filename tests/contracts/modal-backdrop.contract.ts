import assert from "node:assert/strict"

import { test } from "vitest"

import { requireBrowserFixture, ui } from "./lib/app"

test("modal portals blur the page without filtering their popups or backdrops", async () => {
  await requireBrowserFixture()
  for (const [slot, imageLightbox, expected] of [
    ["dialog", false, "blur(4px)"],
    ["alert-dialog", false, "blur(4px)"],
    ["sheet", false, "blur(4px)"],
    ["dialog", true, "blur(8px)"]
  ] as const) {
    const result = await ui(`(() => {
      const root = document.querySelector("#root");
      const portal = document.createElement("div");
      const overlay = document.createElement("div");
      const popup = document.createElement("div");
      overlay.dataset.slot = ${JSON.stringify(`${slot}-overlay`)};
      overlay.className = "backdrop-blur-xs";
      popup.dataset.slot = ${JSON.stringify(`${slot}-content`)};
      popup.toggleAttribute("data-image-lightbox", ${imageLightbox});
      popup.toggleAttribute("data-open", true);
      portal.append(overlay, popup);
      root.after(portal);
      try {
        const open = [getComputedStyle(root).filter, getComputedStyle(popup).filter, getComputedStyle(overlay).backdropFilter];
        popup.removeAttribute("data-open");
        return JSON.stringify([...open, getComputedStyle(root).filter]);
      } finally {
        portal.remove();
      }
    })()`)
    assert.deepEqual(JSON.parse(result), [expected, "none", "none", "none"], slot)
  }
})
