import assert from "node:assert/strict"

import { chromium } from "playwright"

// Verify the connected presentation against the same source checkpoints used in the catalog.
const base = process.env.STORYBOOK_URL ?? "http://127.0.0.1:6007"
const index = await (await fetch(`${base}/index.json`)).json()
const entries = Object.values(index.entries)
const flows = entries.filter((entry) => entry.type === "story" && entry.title.startsWith("流程/"))
assert(flows.length > 0)
assert(
  flows.every((entry) => entry.name === "完整流程图"),
  "Standalone workflow pages remain in the sidebar"
)
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const open = async (story, query = "") => {
    await page.goto(`${base}/iframe.html?id=${story}&viewMode=story${query}`)
    await page.locator("[data-workflow-diagram]").waitFor({ timeout: 60_000 })
    await page.waitForFunction(
      () => {
        const steps = [...document.querySelectorAll("[data-workflow-step]")]
        return steps.length && steps.every((step) => step.getAttribute("data-ready") === "true")
      },
      null,
      { timeout: 60_000 }
    )
  }
  await open("workflow-navigation-modules--sequence")
  assert.equal(
    await page.locator("[data-workflow-viewport]").evaluate((node) => node.scrollTop),
    0,
    "Checkpoint focus scrolled away from the first row"
  )
  assert.equal(await page.locator("[data-workflow-action]").count(), 5)
  assert.equal(await page.locator('[data-workflow-action="1"]').innerText(), "点击 · 工具箱")
  assert.equal(await page.locator("[data-workflow-page-title]").count(), 0)
  for (const width of [1440, 2200]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.waitForTimeout(100)
    const cards = await page.locator("[data-workflow-step]").evaluateAll((nodes) =>
      nodes.map((node) => ({
        index: Number(node.getAttribute("data-workflow-step")),
        ...node.getBoundingClientRect().toJSON()
      }))
    )
    assert(cards[0].width >= 1090, "Default overview still compresses pages into tiny thumbnails")
    for (let index = 1; index < cards.length; index++) {
      assert(Math.abs(cards[index].top - cards[0].top) < 1, "Workflow unexpectedly wraps onto another row")
      assert(cards[index].left > cards[index - 1].left, "Workflow does not run left to right")
    }
    assert(
      await page.locator("[data-workflow-viewport]").evaluate((node) => node.scrollWidth > node.clientWidth),
      "Canvas has no horizontal overflow"
    )
    const imageOffsets = await page
      .locator("[data-workflow-step]")
      .evaluateAll((nodes) =>
        nodes.map(
          (node) =>
            node.querySelector("[data-workflow-page-image]").getBoundingClientRect().top -
            node.getBoundingClientRect().top
        )
      )
    assert(
      imageOffsets.every((offset) => Math.abs(offset) < 1),
      "Page previews retain empty title space"
    )
    const rasterTransforms = await page
      .locator("[data-workflow-step] iframe")
      .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).transform))
    assert(
      rasterTransforms.every((transform) => transform === "none"),
      "Page previews still use transform scaling"
    )
  }
  await page.screenshot({ path: "/tmp/workflow-horizontal-overview.png", fullPage: true })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.waitForTimeout(100)
  const viewport = page.locator("[data-workflow-viewport]")
  const area = await viewport.boundingBox()
  const panCanvas = async (fromX, toX, y) => {
    await page.mouse.move(fromX, y)
    await page.mouse.down()
    await page.mouse.move(toX, y, { steps: 8 })
    await page.mouse.up()
  }
  await panCanvas(900, 600, area.y + 850)
  const leftDrag = await viewport.evaluate((node) => node.scrollLeft)
  assert(leftDrag >= 290, "Dragging the blank canvas did not pan right")
  await panCanvas(600, 760, area.y + 850)
  const rightDrag = await viewport.evaluate((node) => node.scrollLeft)
  assert(rightDrag < leftDrag, "Dragging right did not pan back")
  const firstImage = await page.locator('[data-workflow-step="0"] [data-workflow-page-image]').boundingBox()
  await panCanvas(250, 100, firstImage.y + 100)
  assert((await viewport.evaluate((node) => node.scrollLeft)) > rightDrag, "Dragging a page image did not pan")
  assert.equal(
    await page.locator("[data-workflow-diagram]").getAttribute("data-view"),
    "overview",
    "Dragging a page accidentally opened reading mode"
  )
  assert.equal(await viewport.getAttribute("data-dragging"), "false")
  const retainedScroll = await viewport.evaluate((node) => node.scrollLeft)
  const sourceFrame = page.frames().find((frame) => new URL(frame.url()).searchParams.get("workflowStep") === "1")
  assert.equal(await sourceFrame.evaluate(() => window.innerWidth), 1200, "Layout zoom changed the source viewport")
  assert.equal(await page.getByRole("toolbar", { name: "流程图控制" }).getByRole("button").count(), 2)
  assert.equal(await viewport.getByRole("button").count(), 0, "Page click-to-read controls remain")
  await page.mouse.click(400, firstImage.y + 100)
  assert.equal(await page.locator("[data-workflow-diagram]").getAttribute("data-view"), "overview")
  assert.equal(await viewport.evaluate((node) => node.scrollLeft), retainedScroll)
  assert.equal((await page.locator('[data-workflow-step="0"]').boundingBox()).width, 1100)
  console.log(
    "Single horizontal row, 1100px pages, no page titles, dragging, inactive page clicks and zoom-only toolbar passed"
  )
  await open("workflow-plugins-install--sequence")
  assert.equal(await page.locator("[data-workflow-step]").count(), 3)
  assert.equal(await page.locator("[data-workflow-connections] > path").count(), 2)
  const checkpoints = page.frames().filter((frame) => frame.url().includes("workflowStep="))
  await checkpoints[0].getByRole("button", { name: "Documents", exact: true }).waitFor()
  await checkpoints[1].getByRole("heading", { name: "Documents", exact: true }).waitFor()
  assert.equal(checkpoints.length, 3)
  await page.screenshot({ path: "/tmp/workflow-diagram-plugins.png", fullPage: true })
  const initial = await page.locator("[data-workflow-zoom]").innerText()
  await page.getByRole("button", { name: "放大流程图", exact: true }).click()
  assert.notEqual(await page.locator("[data-workflow-zoom]").innerText(), initial)
  await page.getByRole("button", { name: "缩小流程图", exact: true }).click()
  assert.equal(await page.locator("[data-workflow-zoom]").innerText(), initial)
  await page.setViewportSize({ width: 680, height: 800 })
  assert.equal((await page.locator('[data-workflow-step="0"]').boundingBox()).width, 1100)
  assert(await page.getByRole("button", { name: "放大流程图", exact: true }).isVisible())
  await page.setViewportSize({ width: 1440, height: 1000 })
  for (const story of [
    "workflow-navigation-guide--sequence",
    "workflow-plugin-recovery-install--sequence",
    "workflow-settings-sections--sequence"
  ]) {
    await open(story)
    const steps = await page.locator("[data-workflow-step]").count()
    assert.equal(await page.locator("[data-workflow-connections] > path").count(), steps - 1)
    console.log(`${story}: ${steps} source pages and ${steps - 1} connections passed`)
  }
  await page.screenshot({ path: "/tmp/workflow-diagram-settings.png", fullPage: true })
  await open("workflow-plugins-install--sequence", "&globals=theme:dark;locale:zh-CN")
  for (const frame of page.frames().filter((frame) => frame.url().includes("workflowStep="))) {
    assert(await frame.locator("html").evaluate((element) => element.classList.contains("dark")))
    await frame
      .getByRole("button", { name: /安装|卸载/ })
      .first()
      .waitFor()
  }
  await page.screenshot({ path: "/tmp/workflow-diagram-dark.png", fullPage: true })
  console.log(
    `${flows.length} workflow entries; no standalone pages; source checkpoints, modal/menu isolation, zoom, narrow viewport and theme passed`
  )
} finally {
  await browser.close()
}
