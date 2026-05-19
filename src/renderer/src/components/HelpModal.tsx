import React, { Fragment, useEffect, useMemo, useState } from 'react'
import ctcLogo from '../assets/images/ctc.logo.png'
import workflowsDoc from '../../../../docs/workflows.md?raw'
import featuresDoc from '../../../../docs/features.md?raw'
import trainingDoc from '../../../../docs/training.md?raw'

export type HelpModalTab = 'workflows' | 'features' | 'training' | 'about'

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

function renderInline(text: string): React.ReactNode[] {
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

function MarkdownViewer({ markdown }: { markdown: string }) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const blocks: React.ReactNode[] = []
  let i = 0

  while (i < lines.length) {
    const rawLine = lines[i]
    const line = rawLine.trim()

    if (!line) {
      i += 1
      continue
    }

    if (line === '---') {
      blocks.push(<hr key={`hr-${i}`} className="border-gray-200 dark:border-gray-800 my-5" />)
      i += 1
      continue
    }

    if (line.startsWith('![')) {
      i += 1
      continue
    }

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

    if (/^- /.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^- /.test(lines[i].trim())) {
        items.push(lines[i].trim().slice(2))
        i += 1
      }
      blocks.push(
        <ul key={`ul-${i}`} className="list-disc pl-5 space-y-1 text-sm text-gray-700 dark:text-gray-300">
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
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
            <li key={idx}>{renderInline(item)}</li>
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
      !lines[i].trim().startsWith('![')
    ) {
      paragraphLines.push(lines[i].trim())
      i += 1
    }

    blocks.push(
      <p key={`p-${i}`} className="text-sm leading-6 text-gray-700 dark:text-gray-300">
        {renderInline(paragraphLines.join(' '))}
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
          <aside className="w-56 border-r border-gray-200 dark:border-gray-800 p-4 space-y-2 flex-shrink-0">
            <button
              onClick={() => setTab('workflows')}
              className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                tab === 'workflows'
                  ? 'bg-sky-100 dark:bg-sky-900/30 text-sky-800 dark:text-sky-200'
                  : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
              }`}
            >
              Workflow Guide
            </button>
            <button
              onClick={() => setTab('features')}
              className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                tab === 'features'
                  ? 'bg-sky-100 dark:bg-sky-900/30 text-sky-800 dark:text-sky-200'
                  : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
              }`}
            >
              Feature Reference
            </button>
            <button
              onClick={() => setTab('training')}
              className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                tab === 'training'
                  ? 'bg-sky-100 dark:bg-sky-900/30 text-sky-800 dark:text-sky-200'
                  : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
              }`}
            >
              Training Guide
            </button>
            <button
              onClick={() => setTab('about')}
              className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                tab === 'about'
                  ? 'bg-sky-100 dark:bg-sky-900/30 text-sky-800 dark:text-sky-200'
                  : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
              }`}
            >
              About NAM Lab
            </button>
            <div className="pt-3 text-[11px] text-gray-500 dark:text-gray-500 leading-5">
              Use the workflow guide for process help, the feature reference for capability detail,
              and About for version, contact, and update info.
            </div>
          </aside>

          <div className="flex-1 overflow-y-auto px-6 py-5">
            {tab === 'about' ? <AboutPanel /> : <MarkdownViewer markdown={docs[tab]} />}
          </div>
        </div>
      </div>
    </div>
  )
}
