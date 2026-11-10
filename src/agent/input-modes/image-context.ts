/** Application-owned instructions; ACP transports the completed context without interpreting it. */
export function imageApplicationContext(intent: unknown, instructions?: string): Record<string, string> {
  if (intent !== null && intent !== "generate" && intent !== "edit") throw new Error("Invalid image intent")
  const value =
    intent === null
      ? "The current message uses ordinary chat input. For image generation or editing, use the native image generation tool, never the application generate_image tool. Do not apply application image-model settings or earlier application image-workflow instructions. Image generation is not implied by the input mode; follow the user's request."
      : [
          intent === "edit"
            ? "The current message requests an image edit. Use the application generate_image tool and the supplied source and reference attachments. Follow the specific editing instructions in the user message."
            : "The user selected image input for the current message. Treat descriptions as requests to generate or edit images using the application generate_image tool. Use attached images as references when relevant. Answer questions about previous results normally; do not generate another image unless requested.",
          "Use only the application's selected image model for this image conversation. Do not substitute a native image generation tool.",
          instructions
        ]
          .filter(Boolean)
          .join("\n\n")
  return { "alwith.imageIntent": value }
}
