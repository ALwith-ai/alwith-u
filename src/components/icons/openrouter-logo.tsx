// OpenRouter has no logo in ALwith Desktop's icon set; this is OpenRouter's own mark
// (the crossed routes from openrouter.ai), drawn in currentColor.
import type { SVGProps } from "react"

export function OpenRouterLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      {...props}>
      <title>OpenRouter</title>
      <path d="M2 7h3.5c1.6 0 2.6.5 3.6 1.7l3 3.6c1 1.2 2 1.7 3.6 1.7H20" />
      <path d="M2 17h3.5c1.6 0 2.6-.5 3.6-1.7l3-3.6c1-1.2 2-1.7 3.6-1.7H20" />
      <path d="M17.5 4.5L21 7l-3.5 2.5M17.5 14.5L21 17l-3.5 2.5" />
    </svg>
  )
}
