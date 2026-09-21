// Catches React render crashes and shows the error instead of a blank window.
import { error as logError } from "@tauri-apps/plugin-log"
import { Component, type ErrorInfo, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import i18n from "@/lib/i18n"

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  error: Error | null
  errorInfo: ErrorInfo | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, errorInfo: null }
  private readonly handleLanguageChanged = () => this.forceUpdate()

  componentDidMount() {
    i18n.on("languageChanged", this.handleLanguageChanged)
  }

  componentWillUnmount() {
    i18n.off("languageChanged", this.handleLanguageChanged)
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // The production UI only says "Something went wrong."; the details live in the log file.
    void logError(
      `[react] ${error.message}\n${error.stack ?? ""}\ncomponentStack:${errorInfo.componentStack ?? ""}`
    ).catch(failure => console.error("[logError]", failure))
    this.setState({ error, errorInfo })
  }

  render() {
    const { error, errorInfo } = this.state
    if (!error) return this.props.children
    if (this.props.fallback) return this.props.fallback
    const isDev = import.meta.env.DEV
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="flex max-w-xl flex-col gap-4">
          {isDev ? (
            <>
              <div className="flex items-center gap-2">
                <span className="bg-primary/15 text-primary rounded px-2 py-0.5 text-xs font-medium">
                  {i18n.t("errorBoundary.label")}
                </span>
                <span className="text-sm font-medium">{error.message}</span>
              </div>
              {error.stack && (
                <pre className="bg-muted/50 max-h-[300px] overflow-auto rounded-lg border p-4 font-mono text-xs break-all whitespace-pre-wrap">
                  {error.stack}
                </pre>
              )}
              {errorInfo?.componentStack && (
                <details>
                  <summary className="text-muted-foreground cursor-pointer text-xs">
                    {i18n.t("errorBoundary.componentStack")}
                  </summary>
                  <pre className="bg-muted/50 mt-2 max-h-[200px] overflow-auto rounded-lg border p-4 font-mono text-xs break-all whitespace-pre-wrap">
                    {errorInfo.componentStack}
                  </pre>
                </details>
              )}
            </>
          ) : (
            <p className="text-muted-foreground text-sm">{i18n.t("errorBoundary.title")}</p>
          )}
          <div>
            <Button variant="secondary" size="sm" onClick={() => this.setState({ error: null, errorInfo: null })}>
              {i18n.t("errorBoundary.retry")}
            </Button>
          </div>
        </div>
      </div>
    )
  }
}
