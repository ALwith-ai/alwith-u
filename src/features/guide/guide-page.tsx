import { CodexMarkdownRenderer, type MarkdownHost } from "@alwith/module-chat/markdown"
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BookOpenIcon,
  CheckIcon,
  CloudIcon,
  CpuIcon,
  FileTextIcon,
  FolderIcon,
  KeyboardIcon,
  LayersIcon,
  MessageSquareIcon,
  PanelLeftIcon,
  PlayIcon,
  PlusIcon,
  SearchIcon,
  ShieldCheckIcon,
  WrenchIcon
} from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { AuxWindowShell } from "@/components/alwith-ui/aux-window-shell"
import { useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import { openExternal } from "@/lib/open"

import content from "../../../guide/index.md?raw"
import logo from "../../../src-tauri/icons/128x128.png"
import "@alwith/module-chat/styles.css"
import "./guide.css"

const chapters = content.split(/^## /m).map((chapter, index) => {
  if (index === 0) return { title: "Welcome", text: chapter }
  const end = chapter.indexOf("\n")
  return { title: chapter.slice(0, end), text: chapter.slice(end + 1) }
})
const details = [
  {
    icon: BookOpenIcon,
    summary: "A practical handbook for your everyday work with ALwith U.",
    group: "Overview",
    takeaway: "Choose a task below, or follow the getting-started path."
  },
  {
    icon: PlayIcon,
    summary: "Set up access, choose a project, and complete your first useful task.",
    group: "Getting started",
    takeaway: "ALwith login and model access are configured separately."
  },
  {
    icon: PanelLeftIcon,
    summary: "Learn where conversations, tools, files, and settings live.",
    group: "Getting started",
    takeaway: "Keep the conversation and its project files in view together."
  },
  {
    icon: MessageSquareIcon,
    summary: "Write a clear request, manage a running turn, and review the result.",
    group: "Daily work",
    takeaway: "Ask for a concrete outcome and evidence that it works."
  },
  {
    icon: CpuIcon,
    summary: "Connect a provider and select the right model for each conversation.",
    group: "Daily work",
    takeaway: "The selected model belongs to the conversation you are working in."
  },
  {
    icon: FolderIcon,
    summary: "Navigate, preview, edit, and review files alongside the assistant.",
    group: "Daily work",
    takeaway: "Confirm the project folder before allowing file changes."
  },
  {
    icon: LayersIcon,
    summary: "Understand skills, Codex plugins, and application extensions.",
    group: "Make it yours",
    takeaway: "Inspect what an integration does and what access it needs."
  },
  {
    icon: CloudIcon,
    summary: "Check cloud transfers and manage your Vibémon companion.",
    group: "Make it yours",
    takeaway: "Verify transfer status before relying on a cloud copy."
  },
  {
    icon: KeyboardIcon,
    summary: "Adjust your workspace and learn the shortcuts you will use most.",
    group: "Make it yours",
    takeaway: "Use button tooltips to discover shortcuts as you work."
  },
  {
    icon: WrenchIcon,
    summary: "Diagnose connection, model, file, and integration problems.",
    group: "Support",
    takeaway: "Capture the exact error and check for partial changes before retrying."
  }
]

function InterfaceMap({ navigate }: { navigate: (index: number) => void }) {
  return (
    <div className="guide-interface">
      <div className="guide-interface-bar">
        <img className="guide-interface-mark" src={logo} alt="" />
        <strong>ALwith U</strong>
        <span>Interface map</span>
      </div>
      <div className="guide-interface-body">
        <div className="guide-interface-sidebar">
          <div className="guide-interface-tools">
            <SearchIcon />
            <PlusIcon />
          </div>
          <span className="guide-interface-label">Your projects</span>
          <div className="guide-interface-project">
            <FolderIcon /> My project
          </div>
          <Button variant="secondary" onClick={() => navigate(2)}>
            <MessageSquareIcon /> First task
          </Button>
          <div className="guide-interface-account">Account & settings</div>
        </div>
        <div className="guide-interface-chat">
          <span className="guide-interface-label">A conversation with context</span>
          <div className="guide-interface-request">Explain this project before making changes.</div>
          <div className="guide-interface-response">
            <ShieldCheckIcon />
            <span>
              Read the files.
              <br />
              Explain the approach.
              <br />
              Review the result.
            </span>
          </div>
          <Button variant="outline" className="guide-interface-compose" onClick={() => navigate(3)}>
            Describe your next task
            <ArrowRightIcon />
          </Button>
        </div>
        <div className="guide-interface-files">
          <FileTextIcon />
          <span>README.md</span>
          <div />
          <div />
          <div />
          <Button variant="ghost" onClick={() => navigate(5)}>
            Open files
          </Button>
        </div>
      </div>
      <p>Click a part of the workspace to learn how it works.</p>
    </div>
  )
}

function GuideHome({ navigate }: { navigate: (index: number) => void }) {
  return (
    <div className="guide-home">
      <section className="guide-hero">
        <div className="guide-hero-copy">
          <span className="guide-edition">
            <BookOpenIcon /> The ALwith U handbook
          </span>
          <h1>
            Turn a clear request
            <br />
            into work you can verify.
          </h1>
          <p>
            Get comfortable with your independent desktop client: start a conversation, bring the right files into
            context, and review what your assistant produces.
          </p>
          <div className="guide-hero-actions">
            <Button size="lg" onClick={() => navigate(1)}>
              Start your first task
              <ArrowRightIcon />
            </Button>
            <Button variant="outline" size="lg" onClick={() => navigate(2)}>
              Explore the interface
            </Button>
          </div>
          <span className="guide-availability">English edition. Included with your app. Available offline.</span>
        </div>
        <InterfaceMap navigate={navigate} />
      </section>
      <section className="guide-path" aria-label="Getting started path">
        <div>
          <span className="guide-step">1</span>
          <strong>Connect</strong>
          <p>Sign in and configure model access.</p>
        </div>
        <div>
          <span className="guide-step">2</span>
          <strong>Give context</strong>
          <p>Choose a project and define the outcome.</p>
        </div>
        <div>
          <span className="guide-step">3</span>
          <strong>Review</strong>
          <p>Inspect changes and check the evidence.</p>
        </div>
      </section>
      <section className="guide-topics">
        <div className="guide-section-heading">
          <h2>What would you like to do?</h2>
          <p>Jump into the part of the workflow you need.</p>
        </div>
        <div className="guide-topic-grid">
          {[3, 4, 5, 6, 7, 9].map((index) => {
            const Icon = details[index].icon
            return (
              <Button key={index} variant="outline" className="guide-topic-card" onClick={() => navigate(index)}>
                <Icon />
                <span>
                  <strong>{chapters[index].title}</strong> <span>{details[index].summary}</span>
                </span>
                <ArrowRightIcon />
              </Button>
            )
          })}
        </div>
      </section>
      <section className="guide-first-task">
        <div>
          <span className="guide-example-label">Try it in your next chat</span>
          <h2>A small task is the best place to start.</h2>
          <p>Choose a project folder, then ask the assistant to explain it before editing anything.</p>
        </div>
        <blockquote>
          Read this project's README and explain how to run it. Do not change files. Tell me which steps you verified
          and which ones remain untested.
        </blockquote>
      </section>
      <footer className="guide-home-footer">
        <span>ALwith U Guide</span>
        <span>An independent client powered by Codex CLI.</span>
      </footer>
    </div>
  )
}

export function GuidePage() {
  const [selected, setSelected] = useState(0)
  const { resolvedTheme } = useTheme()
  const host = useMemo<MarkdownHost>(
    () => ({
      theme: resolvedTheme,
      copyLabel: "Copy",
      openLink: (url) => {
        void openExternal(url).catch((error: unknown) => toast.error(String(error)))
      }
    }),
    [resolvedTheme]
  )
  const chapter = chapters[selected]
  const detail = details[selected]
  return (
    <AuxWindowShell
      title="ALwith U Guide"
      showTitleBar={!/Win/.test(navigator.platform)}
      sidebarClassName="guide-sidebar"
      className="guide-window"
      sidebar={
        <nav aria-label="Guide chapters" className="guide-navigation">
          <div className="guide-brand">
            <img src={logo} alt="" />
            <strong>ALwith U</strong>
          </div>
          {chapters.map((item, index) => {
            const Icon = details[index].icon
            return (
              <div key={item.title}>
                {(index === 0 || details[index - 1].group !== details[index].group) && (
                  <p className="guide-navigation-group">{details[index].group}</p>
                )}
                <Button
                  variant="ghost"
                  className="guide-navigation-item"
                  aria-current={selected === index ? "page" : undefined}
                  onClick={() => setSelected(index)}
                >
                  <Icon />
                  {item.title}
                </Button>
              </div>
            )
          })}
          <div className="guide-navigation-footer">
            <CheckIcon />
            <span>
              Bundled with ALwith U<br />
              <small>English edition</small>
            </span>
          </div>
        </nav>
      }
    >
      <main key={selected} className="guide-main" aria-label={chapter.title}>
        {selected === 0 ? (
          <GuideHome navigate={setSelected} />
        ) : (
          <div className="guide-reading">
            <header className="guide-reading-header">
              <Button variant="ghost" size="sm" onClick={() => setSelected(0)}>
                <ArrowLeftIcon />
                Guide home
              </Button>
              <span>{detail.group}</span>
            </header>
            <div className="guide-reading-layout">
              <article>
                <div className="guide-chapter-heading">
                  <detail.icon />
                  <h1>{chapter.title}</h1>
                  <p>{detail.summary}</p>
                </div>
                <div className="guide-key-point">
                  <ShieldCheckIcon />
                  <p>{detail.takeaway}</p>
                </div>
                <div className="guide-prose">
                  <CodexMarkdownRenderer text={chapter.text} host={host} />
                </div>
              </article>
              <aside className="guide-reading-aside">
                <strong>In this chapter</strong>
                {chapter.text
                  .split(/^### /m)
                  .slice(1)
                  .map((part) => (
                    <p key={part.split("\n")[0]}>{part.split("\n")[0]}</p>
                  ))}
                <div>
                  <BookOpenIcon />
                  <p>Work through the steps with your own project open beside the guide.</p>
                </div>
              </aside>
            </div>
            <nav className="guide-page-navigation" aria-label="Adjacent chapters">
              <Button
                variant="outline"
                aria-label={`Previous ${chapters[selected - 1].title}`}
                onClick={() => setSelected(selected - 1)}
              >
                <ArrowLeftIcon />
                <span>
                  <small>Previous</small>
                  {chapters[selected - 1].title}
                </span>
              </Button>
              {selected < chapters.length - 1 && (
                <Button
                  variant="outline"
                  aria-label={`Next ${chapters[selected + 1].title}`}
                  onClick={() => setSelected(selected + 1)}
                >
                  <span>
                    <small>Next</small>
                    {chapters[selected + 1].title}
                  </span>
                  <ArrowRightIcon />
                </Button>
              )}
            </nav>
          </div>
        )}
      </main>
    </AuxWindowShell>
  )
}
