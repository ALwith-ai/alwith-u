import path from "node:path"

import { parse } from "../node_modules/@babel/parser/lib/index.js"

/**
 * The import a derived story file needs for its source's `meta.component`.
 * Storybook's docgen reads the component only from an imported identifier written in the meta call,
 * so a derived file names the same component instead of reading it from the source's shared annotations.
 */
export function componentImport(source, sourceFile, outputFile) {
  const program = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] }).program
  const meta = program.body
    .flatMap((statement) => (statement.type === "VariableDeclaration" ? statement.declarations : []))
    .find((declaration) => declaration.id.type === "Identifier" && declaration.id.name === "meta")
  if (meta?.init?.type !== "CallExpression") throw new Error(`${sourceFile} has no meta = preview.meta(...)`)
  const annotations = meta.init.arguments[0]
  const property =
    annotations?.type === "ObjectExpression"
      ? annotations.properties.find((entry) => entry.type === "ObjectProperty" && entry.key.name === "component")
      : undefined
  if (property?.value.type !== "Identifier") throw new Error(`${sourceFile} must name meta.component as an identifier`)
  const name = property.value.name
  const relative = (target) => {
    const specifier = path.relative(path.dirname(outputFile), target).split(path.sep).join("/")
    return specifier.startsWith(".") ? specifier : `./${specifier}`
  }
  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration") continue
    const specifier = statement.specifiers.find((entry) => entry.local.name === name)
    if (!specifier) continue
    if (specifier.type === "ImportNamespaceSpecifier") throw new Error(`${sourceFile} imports ${name} as a namespace`)
    const from = statement.source.value.startsWith(".")
      ? relative(path.resolve(path.dirname(sourceFile), statement.source.value))
      : statement.source.value
    const binding =
      specifier.type === "ImportDefaultSpecifier"
        ? name
        : specifier.imported.name === name
          ? `{ ${name} }`
          : `{ ${specifier.imported.name} as ${name} }`
    return { name, statement: `import ${binding} from "${from}"` }
  }
  const exported = program.body.some(
    (statement) =>
      statement.type === "ExportNamedDeclaration" &&
      (statement.declaration?.id?.name === name ||
        statement.declaration?.declarations?.some((declaration) => declaration.id.name === name))
  )
  if (!exported) throw new Error(`${sourceFile} must export its local component ${name}`)
  return { name, statement: `import { ${name} } from "${relative(sourceFile)}"` }
}
