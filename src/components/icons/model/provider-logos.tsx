import { type SVGProps } from "react"

// The ALwith enterprise mark; the shared marks come from module-chat.
export function AlwithEnterpriseLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="-3 -3 30 30" fill="#ee305a" {...props}>
      <path d="M1.5 1.5h21v21h-7v-7h-7v-7h-7zM1.5 15.5h7v7h-7z" />
    </svg>
  )
}
