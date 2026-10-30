import type { Plugin } from "vite"

/** Reject dependency bundles compiled against React's development-only JSX runtime. */
export function productionJsxGuard(): Plugin {
  return {
    name: "production-jsx-guard",
    apply: "build",
    transform(code, id) {
      if (!/\.[cm]?js(?:\?|$)/.test(id) || !code.includes("react/jsx-dev-runtime")) return
      for (const statement of this.parse(code).body) {
        if (
          (statement.type === "ImportDeclaration" ||
            statement.type === "ExportNamedDeclaration" ||
            statement.type === "ExportAllDeclaration") &&
          statement.source?.value === "react/jsx-dev-runtime"
        ) {
          this.error(`Development JSX in production bundle: ${id}. Rebuild the dependency with production JSX.`)
        }
      }
    }
  }
}
