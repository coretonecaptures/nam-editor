import React, { Fragment, useEffect, useMemo, useState } from 'react'
import ctcLogo from '../assets/images/ctc.logo.png'
import workflowsDoc from '../../../../docs/workflows.md?raw'
import featuresDoc from '../../../../docs/features.md?raw'
import trainingDoc from '../../../../docs/training.md?raw'
import a2Doc from '../../../../docs/a2-status.md?raw'
import installDoc from '../../../../docs/install.md?raw'

export type HelpModalTab = 'workflows' | 'features' | 'training' | 'a2' | 'install' | 'about'

// Map relative .md filenames to their tab IDs so internal doc links navigate within the modal
const MD_LINK_TO_TAB: Record<string, HelpModalTab> = {
  'workflows.md': 'workflows',
  'features.md': 'features',
  'training.md': 'training',
  'a2-status.md': 'a2',
  'install.md': 'install',
}

interface HelpModalProps {
  initialTab?: HelpModalTab
  onClose: () => void
}

type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; version: string; url: string }
  | { status: 'up-to-date' }
  | { status: 'error'; message: string }

function renderInline(text: string, onNavigate?: (tab: HelpModalTab) => void): React.ReactNode[] {
  const segments = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g)
  return segments.map((segment, idx) => {
    if (!segment) return null
    if (segment.startsWith('`') && segment.endsWith('`')) {
      return (
        <code
          key={`code-${idx}`}
          className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-[11px] text-indigo-700 dark:text-indigo-300"
        >
          {segment.slice(1, -1)}
        </code>
      )
    }
    if (segment.startsWith('**') && segment.endsWith('**')) {
      return <strong key={`bold-${idx}`}>{segment.slice(2, -2)}</strong>
    }
    const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(segment)
    if (linkMatch) {
      const [, label, href] = linkMatch
      const internalTab = MD_LINK_TO_TAB[href]
      if (internalTab && onNavigate) {
        return (
          <button
            key={`link-${idx}`}
            onClick={() => onNavigate(internalTab)}
            className="text-sky-600 dark:text-sky-400 hover:text-sky-500 underline underline-offset-2"
          >
            {label}
          </button>
        )
      }
      return (
        <button
          key={`link-${idx}`}
          onClick={() => { void window.api.openExternal(href) }}
          className="text-sky-600 dark:text-sky-400 hover:text-sky-500 underline underline-offset-2"
        >
          {label}
        </button>
      )
    }
    return <Fragment key={`text-${idx}`}>{segment}</Fragment>
  })
}

export function MarkdownViewer({ markdown, onNavigate }: { markdown: string; onNavigate?: (tab: HelpModalTab) => void }) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const blocks: React.ReactNode[] = []
  let i = 0

  while (i < lines.length) {
    const rawLine = lines[i]
    const line = rawLine.trim()

    if (!line) { i += 1; continue }

    if (line === '---') {
      blocks.push(<hr key={`hr-${i}`} className="border-gray-200 dark:border-gray-800 my-5" />)
      i += 1
      continue
    }

    if (line.startsWith('![')) { i += 1; continue }

    if (line.startsWith('# ')) {
      blocks.push(
        <h1 key={`h1-${i}`} className="text-xl font-semibold text-gray-900 dark:text-gray-100 mt-1 mb-4">
          {line.slice(2)}
        </h1>
      )
      i += 1
      continue
    }

    if (line.startsWith('## ')) {
      blocks.push(
        <h2 key={`h2-${i}`} className="text-base font-semibold text-gray-900 dark:text-gray-100 mt-6 mb-3">
          {line.slice(3)}
        </h2>
      )
      i += 1
      continue
    }

    if (line.startsWith('### ')) {
      blocks.push(
        <h3 key={`h3-${i}`} className="text-sm font-semibold text-gray-900 dark:text-gray-100 mt-4 mb-2">
          {line.slice(4)}
        </h3>
      )
      i += 1
      continue
    }

    if (line.startsWith('#### ')) {
      blocks.push(
        <h4 key={`h4-${i}`} className="text-sm font-semibold text-gray-800 dark:text-gray-200 mt-3 mb-1.5">
          {line.slice(5)}
        </h4>
      )
      i += 1
      continue
    }

    // Table support: lines starting with |
    if (line.startsWith('|')) {
      const tableLines: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i].trim())
        i += 1
      }
      // Filter out separator rows (|---|---|)
      const dataRows = tableLines.filter((l) => !/^\|[\s\-|:]+\|$/.test(l))
      if (dataRows.length > 0) {
        const parseRow = (l: string) => l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
        const [headerRow, ...bodyRows] = dataRows
        const headers = parseRow(headerRow)
        blocks.push(
          <div key={`table-${i}`} className="overflow-x-auto my-3">
            <table className="text-xs w-full border-collapse">
              <thead>
                <tr>
                  {headers.map((h, hi) => (
                    <th key={hi} className="text-left px-3 py-1.5 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-semibold border border-gray-200 dark:border-gray-700">
                      {renderInline(h, onNavigate)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bodyRows.map((row, ri) => (
                  <tr key={ri} className={ri % 2 === 0 ? '' : 'bg-gray-50 dark:bg-gray-800/40'}>
                    {parseRow(row).map((cell, ci) => (
                      <td key={ci} className="px-3 py-1.5 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                        {renderInline(cell, onNavigate)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }
      continue
    }

    if (/^- /.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^- /.test(lines[i].trim())) {
        items.push(lines[i].trim().slice(2))
        i += 1
      }
      blocks.push(
        <ul key={`ul-${i}`} className="list-disc pl-5 space-y-1 text-sm text-gray-700 dark:text-gray-300">
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item, onNavigate)}</li>
          ))}
        </ul>
      )
      continue
    }

    if (/^\d+\.\s/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s/, ''))
        i += 1
      }
      blocks.push(
        <ol key={`ol-${i}`} className="list-decimal pl-5 space-y-1 text-sm text-gray-700 dark:text-gray-300">
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item, onNavigate)}</li>
          ))}
        </ol>
      )
      continue
    }

    const paragraphLines: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      lines[i].trim() !== '---' &&
      !lines[i].trim().startsWith('#') &&
      !/^- /.test(lines[i].trim()) &&
      !/^\d+\.\s/.test(lines[i].trim()) &&
      !lines[i].trim().startsWith('![') &&
      !lines[i].trim().startsWith('|')
    ) {
      paragraphLines.push(lines[i].trim())
      i += 1
    }

    // Safety net: every branch above either matches its prefix and consumes at least one line, or
    // falls through to here. If NONE of them matched — a line starting with `#` at a depth deeper
    // than the levels rendered above is exactly how this broke once already — the while loop just
    // ran never advances `i`, and the outer `while (i < lines.length)` spins forever, growing
    // `blocks` until the tab's memory use crashes the renderer. Rendering the raw line as a
    // paragraph guarantees `i` always moves forward by at least one line, no matter what a future
    // doc edit contains, instead of trusting every edit to only ever use the exact prefixes above.
    if (paragraphLines.length === 0 && i < lines.length) {
      paragraphLines.push(lines[i])
      i += 1
    }

    blocks.push(
      <p key={`p-${i}`} className="text-sm leading-6 text-gray-700 dark:text-gray-300">
        {renderInline(paragraphLines.join(' '), onNavigate)}
      </p>
    )
  }

  return <div className="space-y-3">{blocks}</div>
}

function AboutPanel() {
  const [updateState, setUpdateState] = useState<UpdateState>({ status: 'idle' })
  const version = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? 'dev'

  const handleCheckForUpdates = async () => {
    setUpdateState({ status: 'checking' })
    const result = await window.api.checkForUpdates(false)
    if (result.error) {
      setUpdateState({ status: 'error', message: result.error })
      return
    }
    if (result.hasUpdate && result.latestVersion && result.releaseUrl) {
      setUpdateState({ status: 'available', version: result.latestVersion, url: result.releaseUrl })
      return
    }
    setUpdateState({ status: 'up-to-date' })
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-start gap-5">
        <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-indigo-600/30 to-sky-500/20 border border-indigo-500/20 flex items-center justify-center overflow-hidden flex-shrink-0 p-3">
          <img src={ctcLogo} alt="Core Tone Captures" className="w-full h-full object-contain" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">About NAM Lab</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Version {version}
          </p>
          <div className="mt-4 space-y-2 text-sm text-gray-700 dark:text-gray-300">
            <p><strong>Created by Core Tone Captures</strong></p>
            <p>
              NAM Lab exists to make Neural Amp Modeler libraries easier to organize, clean up, tag,
              and manage. It was built to help creators and collectors spend less time fighting
              filenames, metadata, and folder structures, and more time actually working with great
              captures.
            </p>
            <div className="flex flex-wrap gap-4 pt-1">
              <button
                onClick={() => { void window.api.openExternal('https://coretonecaptures.com') }}
                className="text-sky-600 dark:text-sky-400 hover:text-sky-500 underline underline-offset-2"
              >
                coretonecaptures.com
              </button>
              <button
                onClick={() => { void window.api.openExternal('mailto:info@coretonecaptures.com') }}
                className="text-sky-600 dark:text-sky-400 hover:text-sky-500 underline underline-offset-2"
              >
                info@coretonecaptures.com
              </button>
            </div>
          </div>
          <div className="mt-5 flex items-center gap-3">
            <button
              onClick={handleCheckForUpdates}
              disabled={updateState.status === 'checking'}
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-60 transition-colors"
            >
              {updateState.status === 'checking' ? 'Checking...' : 'Check for updates'}
            </button>
            {updateState.status === 'available' && (
              <button
                onClick={() => { void window.api.openExternal(updateState.url) }}
                className="text-sm text-amber-600 dark:text-amber-400 hover:text-amber-500 underline underline-offset-2"
              >
                Update available: {updateState.version}
              </button>
            )}
            {updateState.status === 'up-to-date' && (
              <span className="text-sm text-emerald-600 dark:text-emerald-400">
                You have the latest version.
              </span>
            )}
            {updateState.status === 'error' && (
              <span className="text-xs text-red-500">{updateState.message}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

const NAV_ITEMS: { id: HelpModalTab; label: string; badge?: string }[] = [
  { id: 'workflows', label: 'Workflow Guide' },
  { id: 'features',  label: 'Feature Reference' },
  { id: 'training',  label: 'Training Guide' },
  { id: 'a2',        label: 'A2' },
  { id: 'install',   label: 'First Launch / Install' },
  { id: 'about',     label: 'About NAM Lab' },
]

export function HelpModal({ initialTab = 'workflows', onClose }: HelpModalProps) {
  const [tab, setTab] = useState<HelpModalTab>(initialTab)

  useEffect(() => {
    setTab(initialTab)
  }, [initialTab])

  const docs = useMemo(
    () => ({
      workflows: workflowsDoc,
      features: featuresDoc,
      training: trainingDoc,
      a2: a2Doc,
      install: installDoc,
    }),
    []
  )

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-6xl mx-4 flex flex-col max-h-[90vh]">
        <div className="px-5 pt-5 pb-3 border-b border-gray-200 dark:border-gray-700 flex items-start justify-between gap-4 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">NAM Lab Help</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Local docs, workflow guidance, and app information in one place.
            </p>
          </div>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-md text-xs font-medium bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors"
          >
            Close
          </button>
        </div>

        <div className="flex flex-1 min-h-0">
          <aside className="w-56 border-r border-gray-200 dark:border-gray-800 p-4 space-y-1 flex-shrink-0">
            {NAV_ITEMS.map(({ id, label, badge }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                  tab === id
                    ? 'bg-sky-100 dark:bg-sky-900/30 text-sky-800 dark:text-sky-200'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
                }`}
              >
                {label}
                {badge && (
                  <span className="ml-1.5 text-[9px] font-semibold uppercase tracking-wide text-pink-500 dark:text-pink-400 bg-pink-100 dark:bg-pink-900/40 px-1 py-px rounded">
                    {badge}
                  </span>
                )}
              </button>
            ))}
          </aside>

          <div
            className="flex-1 overflow-y-auto px-6 py-5 select-text cursor-text"
          >
            {tab === 'about'
              ? <AboutPanel />
              : <MarkdownViewer markdown={docs[tab as keyof typeof docs]} onNavigate={setTab} />
            }
          </div>
        </div>
      </div>
    </div>
  )
}
