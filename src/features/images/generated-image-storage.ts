import { invoke } from "@tauri-apps/api/core"

type ImageBytes = { mimeType: string; data: string }

export const generatedImageStorage = {
  save(sessionId: string, callId: string, images: ImageBytes[]): Promise<string[]> {
    return invoke("save_generated_images", { sessionId, callId, images })
  },
  read(reference: string): Promise<ImageBytes> {
    return invoke("read_generated_image", { reference })
  }
}
