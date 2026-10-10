import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { inspectRequiredSkills } from "../chat/skills"
import type { SkillCatalog } from "./use-skill-catalog"

export function ExtensionSkills({
  required,
  catalog,
  onManage,
  onRefresh
}: {
  required: readonly string[]
  catalog: SkillCatalog
  onManage(): void
  onRefresh(): void
}) {
  const { t } = useTranslation()
  return (
    <section className="mt-2 space-y-2 rounded-md border p-3 text-sm" aria-label={t("extensions.skills.title")}>
      <p className="font-medium">{t("extensions.skills.title")}</p>
      {catalog.status === "loading" && <p role="status">{t("extensions.skills.loading")}</p>}
      {catalog.status === "disconnected" && <p>{t("extensions.skills.disconnected")}</p>}
      {catalog.status === "error" && <p role="alert">{t("extensions.skills.error", { message: catalog.message })}</p>}
      {catalog.status === "loaded" && (
        <>
          <ul className="space-y-1">
            {inspectRequiredSkills(required, catalog.skills).map(skill => (
              <li key={skill.name} className="flex flex-wrap justify-between gap-x-3 gap-y-1">
                <span className="break-all">{skill.status === "enabled" ? skill.resolvedName : skill.name}</span>
                <span className="text-muted-foreground">
                  {t(
                    `extensions.skills.${catalog.errors.length && skill.status !== "enabled" ? "unknown" : skill.status}`
                  )}
                </span>
              </li>
            ))}
          </ul>
          {catalog.errors.length > 0 && (
            <div role="alert">
              <p>{t("extensions.skills.partial")}</p>
              {catalog.errors.map(error => (
                <p key={error.path} className="break-all">
                  {error.path}: {error.message}
                </p>
              ))}
            </div>
          )}
        </>
      )}
      <p className="text-muted-foreground text-xs">{t("extensions.skills.note")}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={onManage}>
          {t("extensions.skills.manage")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={catalog.status === "loading" || catalog.status === "disconnected"}
          onClick={onRefresh}>
          {t("extensions.skills.refresh")}
        </Button>
      </div>
    </section>
  )
}
