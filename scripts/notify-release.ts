import { notifyRelease } from "./lib/release-notification"

try {
  const [directory, tag] = process.argv.slice(2)
  if (!directory || !tag || process.argv.length !== 4) {
    throw new Error("Usage: bun scripts/notify-release.ts <directory> <tag>")
  }
  await notifyRelease(directory, tag, process.env.LARK_ROBOT_URL ?? "")
  console.log(`Feishu notification sent for ${tag}.`)
} catch (error) {
  console.error(error instanceof Error ? error.message : "Feishu notification failed")
  process.exitCode = 1
}
