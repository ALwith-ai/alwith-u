import type { ReactNode } from "react"

// Solar Window Frame (line duotone), by 480 Design, CC BY 4.0; see NOTICE.
export function WindowFrameIcon(): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="size-[18px]"
      aria-hidden="true"
    >
      <g opacity="0.5" strokeLinecap="round">
        <path d="M2 9.5H22M9 21.9799V9.5" />
        <path d="M9 6H9.0001M6 6H6.0001" strokeLinejoin="round" />
      </g>
      <path
        d="M2 12C2 7.28595 2 4.92893 3.46447 3.46447C4.92893 2 7.28595 2 12 2C16.714 2 19.0711 2 20.5355 3.46447C22 4.92893 22 7.28595 22 12C22 16.714 22 19.0711 20.5355 20.5355C19.0711 22 16.714 22 12 22C7.28595 22 4.92893 22 3.46447 20.5355C2 19.0711 2 16.714 2 12Z"
        strokeLinecap="round"
      />
      <path d="M12 6H12.0001" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
