import { expect, test } from "bun:test"
import { createHash } from "node:crypto"

import { verifyComputerArtifact } from "../computer-artifact"

test("Cua artifacts must match the pinned digest before extraction", () => {
  const bytes = new TextEncoder().encode("verified artifact")
  const sha256 = createHash("sha256").update(bytes).digest("hex")
  expect(() => verifyComputerArtifact(bytes, sha256)).not.toThrow()
  bytes[0] ^= 1
  expect(() => verifyComputerArtifact(bytes, sha256)).toThrow("checksum mismatch")
})
