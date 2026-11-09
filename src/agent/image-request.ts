const IMAGE_REQUEST_ASPECTS = ["auto", "1:1", "3:4", "9:16", "4:3", "16:9"] as const
export type ImageRequestAspect = (typeof IMAGE_REQUEST_ASPECTS)[number]

export const IMAGE_WORKFLOW_INSTRUCTIONS = [
  "For image generation and editing, use the application generate_image tool. The host owns the selected image model and credentials. Use attached images as references. Do not substitute another image tool or call provider endpoints yourself.",
  "The application already renders, stores and provides downloads for every successful image result. These are image requests, not coding or filesystem tasks. Do not read imagegen skill files, run shell/Python commands, write Base64 or PNG files, or create download links merely to deliver an image. A request for a PNG or transparent background does not request a filesystem export.",
  "Call generate_image once for the requested image or variant batch. After success, finish the turn using the returned image reference, for example ![Image](reference). Do not regenerate a successful result to change its display or packaging. If a capability is unsupported, explain briefly rather than starting another generation or coding task.",
  "In code mode, the tool result may be a string containing JSON metadata followed by image data URIs, rather than an object with a content property. If necessary, output only its first JSON metadata line to obtain the image reference. Do not echo, inspect, decode or write the image data: the host already displays it."
].join("\n\n")

/** Aspect ratio is a per-request instruction, not an undocumented provider parameter. */
export function imageRequestAspect(value: unknown): ImageRequestAspect | undefined {
  if (value === undefined) return undefined
  if (!IMAGE_REQUEST_ASPECTS.includes(value as ImageRequestAspect)) throw new Error("Invalid image aspect ratio")
  return value as ImageRequestAspect
}

export function imageGenerationPrompt(prompt: string, aspect: ImageRequestAspect | undefined): string {
  return aspect && aspect !== "auto"
    ? `${prompt}\n\nProduce the image with an aspect ratio of ${aspect}. Preserve subject proportions without stretching.`
    : prompt
}
