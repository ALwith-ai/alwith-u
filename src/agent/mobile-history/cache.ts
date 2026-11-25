import { createHash, randomUUID } from "node:crypto"
import { closeSync, openSync, readSync, unlinkSync, writeSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setImmediate } from "node:timers/promises"

export const CHUNK = 256 * 1024
const MAX_RANGE_BYTES = 1024 * 1024
export const TTL = 10 * 60 * 1000
const MAX_BYTES = 256 * 1024 * 1024
const digest = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex")
type Entry = { fd: number; sessionId: string; size: number; sha256: string; chunks: string[]; expires: number }

export class ContentCache {
  private entries = new Map<string, Entry>()
  private bytes = 0

  private forget(id: string, entry: Entry): void {
    this.entries.delete(id)
    this.bytes -= entry.size
    closeSync(entry.fd)
  }

  prune(): void {
    for (const [id, entry] of this.entries) if (entry.expires <= Date.now()) this.forget(id, entry)
  }

  close(): void {
    for (const [id, entry] of this.entries) this.forget(id, entry)
  }

  async save(
    sessionId: string,
    bytes: Buffer,
    signal: AbortSignal
  ): Promise<{ contentId: string; sha256: string; byteLength: number }> {
    signal.throwIfAborted()
    if (bytes.length > 64 * 1024 * 1024) throw new Error("History content exceeds 64 MiB")
    this.prune()
    for (const [id, entry] of this.entries) {
      if (this.bytes + bytes.length <= MAX_BYTES && this.entries.size < 4096) break
      this.forget(id, entry)
    }
    const contentId = randomUUID()
    const file = join(tmpdir(), "alwith-mobile-history-" + contentId)
    const fd = openSync(file, "wx+", 0o600)
    try {
      // Keep only a private open handle, so even forced process termination releases the file.
      unlinkSync(file)
      const chunks: string[] = []
      const hash = createHash("sha256")
      for (let offset = 0; offset < bytes.length; offset += CHUNK) {
        if (offset % (4 * CHUNK) === 0) {
          await setImmediate()
          signal.throwIfAborted()
        }
        const chunk = bytes.subarray(offset, offset + CHUNK)
        chunks.push(digest(chunk))
        hash.update(chunk)
        let written = 0
        while (written < chunk.length) {
          const count = writeSync(fd, chunk, written, chunk.length - written, offset + written)
          if (!count) throw new Error("Could not write history content")
          written += count
        }
      }
      const sha256 = hash.digest("hex")
      this.entries.set(contentId, { fd, sessionId, size: bytes.length, sha256, chunks, expires: Date.now() + TTL })
      this.bytes += bytes.length
      return { contentId, sha256, byteLength: bytes.length }
    } catch (error) {
      closeSync(fd)
      throw error
    }
  }

  read(sessionId: string, contentId: string, offset: number, budget: number) {
    this.prune()
    const entry = this.entries.get(contentId)
    if (!entry || entry.sessionId !== sessionId) throw new Error("history_content_expired: reload history")
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset >= entry.size ||
      !Number.isInteger(budget) ||
      budget <= 0 ||
      budget > MAX_RANGE_BYTES
    )
      throw new Error("Invalid content range")
    const end = Math.min(offset + budget, entry.size)
    const slices: Buffer[] = []
    for (let index = Math.floor(offset / CHUNK); index <= Math.floor((end - 1) / CHUNK); index++) {
      const start = index * CHUNK
      const block = Buffer.alloc(Math.min(CHUNK, entry.size - start))
      if (readSync(entry.fd, block, 0, block.length, start) !== block.length || digest(block) !== entry.chunks[index])
        throw new Error("History content damaged")
      slices.push(block.subarray(Math.max(offset - start, 0), Math.min(end - start, block.length)))
    }
    return {
      sessionId,
      contentId,
      offset,
      totalBytes: entry.size,
      sha256: entry.sha256,
      data: Buffer.concat(slices).toString("base64"),
      isLast: end === entry.size
    }
  }
}
