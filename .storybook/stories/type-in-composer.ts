/**
 * Types into the composer as the browser does, leaving the caret after what was typed. The editor
 * reads the caret to decide what a "/" opens; simulated typing leaves it where it was.
 */
export function typeInComposer(field: HTMLElement, text: string): void {
  field.focus()
  if (!field.ownerDocument.execCommand("insertText", false, text))
    throw new Error("The composer did not accept the typed text")
}
