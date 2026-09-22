import { isValidPassword } from "@alwith/module-auth"
import { useEffect, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { authClient, loginPlatform, usePlatformAuth } from "./store"

type Mode = "code" | "password" | "register"
export function AuthGate({ children, auxiliary = false }: { children: ReactNode; auxiliary?: boolean }) {
  const authenticated = usePlatformAuth(s => s.isAuthenticated)
  const loading = usePlatformAuth(s => s.isLoading)
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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [cooldowns, setCooldowns] = useState<Record<string, number>>({})
  const [now, setNow] = useState(Date.now())
  const cooldownKey = `${mode}:${email.trim().toLowerCase()}`
  const seconds = Math.max(0, Math.ceil(((cooldowns[cooldownKey] ?? 0) - now) / 1000))
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError("")
    try {
      await action()
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      setError(
        message === "WAITLISTED"
          ? t("platformAuth.waitlisted")
          : message === "DISABLED"
            ? t("platformAuth.disabled")
            : message || t("platformAuth.failed")
      )
    } finally {
      setBusy(false)
    }
  }
  async function sendCode() {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw new Error(t("platformAuth.invalidEmail"))
    if (mode === "register" && (await authClient.emailExists(email.trim())).registered)
      throw new Error(t("platformAuth.registered"))
    await authClient.sendVerificationCode(email.trim(), mode === "register" ? "REGISTER" : "LOGIN")
    setCooldowns(current => ({ ...current, [cooldownKey]: Date.now() + 60_000 }))
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
    <main className="bg-background text-foreground flex h-dvh flex-col overflow-auto">
      <div data-tauri-drag-region className="h-10 shrink-0" />
      <div className="m-auto flex w-full max-w-sm flex-col gap-6 px-6 py-8">
        <header className="flex flex-col gap-2">
          <h1 className="text-xl font-semibold">{t("app.name")}</h1>
          <p className="text-muted-foreground text-sm">{t("platformAuth.intro")}</p>
        </header>
        <Tabs
          value={mode}
          onValueChange={value => {
            if (value !== "code" && value !== "password" && value !== "register") throw new Error("Invalid login mode")
            setMode(value)
            setCode("")
            setPassword("")
            setError("")
          }}>
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
          onSubmit={event => {
            event.preventDefault()
            void run(submit)
          }}>
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
                onChange={event => setEmail(event.target.value)}
              />
            </Field>
            {mode !== "password" && (
              <Field data-disabled={busy}>
                <FieldLabel htmlFor="alwith-code">{t("platformAuth.code")}</FieldLabel>
                <Input
                  id="alwith-code"
                  autoComplete="one-time-code"
                  required
                  disabled={busy}
                  value={code}
                  onChange={event => setCode(event.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || seconds > 0}
                  onClick={() => void run(sendCode)}>
                  {seconds > 0 ? t("platformAuth.resend", { seconds }) : t("platformAuth.sendCode")}
                </Button>
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
                  onChange={event => setPassword(event.target.value)}
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
              {busy && <Spinner data-icon="inline-start" />}
              {t(mode === "register" ? "platformAuth.register" : "platformAuth.signIn")}
            </Button>
          </FieldGroup>
        </form>
        <p className="text-muted-foreground text-xs">{t("platformAuth.independent")}</p>
      </div>
    </main>
  )
}
