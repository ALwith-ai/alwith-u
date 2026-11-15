import { invoke } from "@tauri-apps/api/core"
import { open } from "@tauri-apps/plugin-dialog"
import { Trash2, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { useStore } from "zustand"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import { addBookmarks, clearHistory, libraryStore, parseBookmarks, removeVisit, toggleBookmark } from "./library"

/** The user's bookmarks and visited pages: find one, open it, or forget it. */
/** A saved login, as the application lists it: never with its password. */
export interface SavedLogin {
  origin: string
  username: string
}

export function LibraryPanel({ onOpen, onClose }: { onOpen: (url: string) => void; onClose: () => void }) {
  const { t } = useTranslation()
  const library = useStore(libraryStore)
  const [filter, setFilter] = useState("")
  const importInput = useRef<HTMLInputElement>(null)
  const query = filter.trim().toLowerCase()
  const matches = (page: { url: string; title: string }) =>
    !query || page.url.toLowerCase().includes(query) || page.title.toLowerCase().includes(query)
  // Saved logins are listed without their passwords, which stay in the system keychain.
  const [logins, setLogins] = useState<SavedLogin[]>([])
  const loadLogins = () =>
    invoke<SavedLogin[] | undefined>("cef_logins")
      .then((values) => setLogins(values ?? []))
      .catch((error: unknown) => toast.error(String(error)))
  useEffect(() => {
    void loadLogins()
  }, [])
  // The file another browser exported is read natively: its passwords go to the keychain, not through here.
  const importLogins = async () => {
    const path = await open({ multiple: false, filters: [{ name: "CSV", extensions: ["csv"] }] })
    if (typeof path !== "string") return
    await invoke<number>("cef_import_logins", { path })
      .then((count) => toast.success(t("browser.importedLogins", { count })))
      .catch((error: unknown) => toast.error(String(error)))
    await loadLogins()
  }
  const shownLogins = logins.filter(
    (login) => !query || login.origin.toLowerCase().includes(query) || login.username.toLowerCase().includes(query)
  )
  const forget = (login: SavedLogin) =>
    void invoke("cef_delete_login", { origin: login.origin, username: login.username })
      .then(() => setLogins((values) => values.filter((value) => value !== login)))
      .catch((error: unknown) => toast.error(String(error)))
  const sections = [
    {
      id: "bookmarks",
      name: t("browser.bookmarks"),
      empty: t("browser.noBookmarks"),
      pages: library.bookmarks.filter(matches),
      remove: (page: { url: string; title: string }) => toggleBookmark(page.url, page.title),
      removeLabel: t("browser.removeBookmark")
    },
    {
      id: "history",
      name: t("browser.history"),
      empty: t("browser.noHistory"),
      pages: library.history.filter(matches),
      remove: (page: { url: string }) => removeVisit(page.url),
      removeLabel: t("browser.removeVisit")
    }
  ]
  return (
    <section aria-label={t("browser.library")} className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4">
      <Tabs defaultValue="bookmarks" className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex shrink-0 items-center gap-2">
          <TabsList>
            {sections.map((section) => (
              <TabsTrigger key={section.id} value={section.id}>
                {section.name}
              </TabsTrigger>
            ))}
            <TabsTrigger value="logins">{t("browser.savedLogins")}</TabsTrigger>
          </TabsList>
          <Input
            aria-label={t("browser.filterLibrary")}
            placeholder={t("browser.filter")}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            className="h-8 max-w-80 min-w-0 flex-1"
          />
          {/* The user picks the file, so nothing of another application is read unasked. */}
          <input
            ref={importInput}
            type="file"
            accept=".html,.htm,.json,text/html,application/json"
            aria-label={t("browser.bookmarkFile")}
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ""
              if (!file) return
              void file
                .text()
                .then((text) => toast.success(t("browser.imported", { count: addBookmarks(parseBookmarks(text)) })))
                .catch((error: unknown) => toast.error(error instanceof Error ? error.message : String(error)))
            }}
          />
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => importInput.current?.click()}>
            {t("browser.importBookmarks")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              void invoke("cef_clear_browsing_data")
                .then(() => toast.success(t("browser.cookiesCleared")))
                .catch((error: unknown) => toast.error(String(error)))
            }
          >
            {t("browser.clearCookies")}
          </Button>
          <Button variant="ghost" size="sm" disabled={library.history.length === 0} onClick={clearHistory}>
            {t("browser.clearHistory")}
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label={t("browser.closeLibrary")} onClick={onClose}>
            <X />
          </Button>
        </div>
        {sections.map((section) => (
          <TabsContent key={section.id} value={section.id} className="min-h-0 flex-1 overflow-auto">
            {section.pages.length === 0 ? (
              <p className="text-sm text-muted-foreground">{query ? t("browser.noMatches") : section.empty}</p>
            ) : (
              <ul className="flex flex-col">
                {section.pages.map((page) => (
                  <li key={page.url} className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="min-w-0 flex-1 justify-start gap-2"
                      onClick={() => onOpen(page.url)}
                    >
                      <span className="truncate">{page.title || page.url}</span>
                      {page.title && <span className="truncate text-muted-foreground">{page.url}</span>}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`${section.removeLabel}：${page.title || page.url}`}
                      onClick={() => section.remove(page)}
                    >
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        ))}
        <TabsContent value="logins" className="min-h-0 flex-1 overflow-auto">
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => void importLogins()}>
              {t("browser.importLogins")}
            </Button>
          </div>
          {shownLogins.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t(query ? "browser.noMatches" : "browser.noSavedLogins")}</p>
          ) : (
            <ul className="flex flex-col">
              {shownLogins.map((login) => (
                <li key={`${login.origin} ${login.username}`} className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="min-w-0 flex-1 justify-start gap-2"
                    onClick={() => onOpen(login.origin)}
                  >
                    <span className="truncate">{login.username || t("browser.noUsername")}</span>
                    <span className="truncate text-muted-foreground">{login.origin}</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${t("browser.deleteLogin")}：${login.username} ${login.origin}`}
                    onClick={() => forget(login)}
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    </section>
  )
}
