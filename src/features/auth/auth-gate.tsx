import { isValidPassword } from "@alwith/module-auth"
import { type ReactNode, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

import { authClient, loginPlatform, usePlatformAuth } from "./store"

type Mode = "code" | "password" | "register"
export function AuthGate({ children, auxiliary = false }: { children: ReactNode; auxiliary?: boolean }) {
  const authenticated = usePlatformAuth((s) => s.isAuthenticated)
  const loading = usePlatformAuth((s) => s.isLoading)
  if (loading)
    return (
      <div className="flex h-dvh items-center justify-center">
        <Spinner />
      </div>
    )
  if (authenticated) return children
  return auxiliary ? null : <PlatformLogin />
}

function PlatformLogin() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<Mode>("code")
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [password, setPassword] = useState("")
  const [pendingAction, setPendingAction] = useState<"sendCode" | "submit" | null>(null)
  const busy = pendingAction !== null
  const [error, setError] = useState("")
  const [cooldowns, setCooldowns] = useState<Record<string, number>>({})
  const [now, setNow] = useState(Date.now())
  const cooldownKey = `${mode}:${email.trim().toLowerCase()}`
  const seconds = Math.max(0, Math.ceil(((cooldowns[cooldownKey] ?? 0) - now) / 1000))
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  async function run(action: "sendCode" | "submit") {
    if (busy) return
    setPendingAction(action)
    setError("")
    try {
      await (action === "sendCode" ? sendCode() : submit())
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setError(
        message === "WAITLISTED"
          ? t("platformAuth.waitlisted")
          : message === "DISABLED"
            ? t("platformAuth.disabled")
            : message || t("platformAuth.failed")
      )
    } finally {
      setPendingAction(null)
    }
  }
  async function sendCode() {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw new Error(t("platformAuth.invalidEmail"))
    if (mode === "register" && (await authClient.emailExists(email.trim())).registered)
      throw new Error(t("platformAuth.registered"))
    await authClient.sendVerificationCode(email.trim(), mode === "register" ? "REGISTER" : "LOGIN")
    setCooldowns((current) => ({ ...current, [cooldownKey]: Date.now() + 60_000 }))
    setNow(Date.now())
  }
  async function submit() {
    if (mode === "register" && !isValidPassword(password)) throw new Error(t("platformAuth.passwordRule"))
    const response =
      mode === "register"
        ? await authClient.register(email.trim(), code.trim(), password)
        : mode === "password"
          ? await authClient.loginWithPassword(email.trim(), password)
          : await authClient.loginWithCode(email.trim(), code.trim())
    await loginPlatform(response)
  }
  return (
    <main className="flex h-dvh flex-col overflow-auto bg-background text-foreground">
      <div data-tauri-drag-region className="h-10 shrink-0" />
      <div className="m-auto flex w-full max-w-md flex-col gap-6 px-6 py-8">
        <header className="flex flex-col gap-2">
          <h1 className="text-xl font-semibold">{t("app.name")}</h1>
          <p className="text-sm text-muted-foreground">{t("platformAuth.intro")}</p>
        </header>
        <Tabs
          value={mode}
          onValueChange={(value) => {
            if (value !== "code" && value !== "password" && value !== "register") throw new Error("Invalid login mode")
            setMode(value)
            setCode("")
            setPassword("")
            setError("")
          }}
        >
          <TabsList className="w-full">
            <TabsTrigger value="code" disabled={busy}>
              {t("platformAuth.codeLogin")}
            </TabsTrigger>
            <TabsTrigger value="password" disabled={busy}>
              {t("platformAuth.passwordLogin")}
            </TabsTrigger>
            <TabsTrigger value="register" disabled={busy}>
              {t("platformAuth.register")}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void run("submit")
          }}
        >
          <FieldGroup>
            <Field data-disabled={busy}>
              <FieldLabel htmlFor="alwith-email">{t("platformAuth.email")}</FieldLabel>
              <Input
                id="alwith-email"
                type="email"
                autoComplete="email"
                required
                disabled={busy}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            {mode !== "password" && (
              <Field data-disabled={busy}>
                <FieldLabel htmlFor="alwith-code">{t("platformAuth.code")}</FieldLabel>
                <div className="flex items-center gap-2">
                  <Input
                    id="alwith-code"
                    className="min-w-0 flex-1"
                    autoComplete="one-time-code"
                    required
                    disabled={busy}
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="shrink-0"
                    disabled={busy || seconds > 0}
                    onClick={() => void run("sendCode")}
                  >
                    {pendingAction === "sendCode" && <Spinner data-icon="inline-start" />}
                    {seconds > 0 ? t("platformAuth.resend", { seconds }) : t("platformAuth.sendCode")}
                  </Button>
                </div>
              </Field>
            )}
            {mode !== "code" && (
              <Field data-disabled={busy}>
                <FieldLabel htmlFor="alwith-password">{t("platformAuth.password")}</FieldLabel>
                <Input
                  id="alwith-password"
                  type="password"
                  autoComplete={mode === "register" ? "new-password" : "current-password"}
                  required
                  disabled={busy}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                {mode === "register" && <FieldDescription>{t("platformAuth.passwordRule")}</FieldDescription>}
              </Field>
            )}
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" disabled={busy}>
              {pendingAction === "submit" && <Spinner data-icon="inline-start" />}
              {t(mode === "register" ? "platformAuth.register" : "platformAuth.signIn")}
            </Button>
          </FieldGroup>
        </form>
        <p className="text-xs text-muted-foreground">{t("platformAuth.independent")}</p>
      </div>
    </main>
  )
}
