import React from 'react'
import { BUILT_IN_CAPTURE_PROFILES, type CaptureProfile } from '../types/trainer'
import type { UserCaptureProfile } from '../types/settings'

interface ArchitectureProfilePickerProps {
  selectedIds: string[]
  onChange: (next: string[]) => void
  userProfiles: UserCaptureProfile[]
  onClone?: (profile: CaptureProfile) => void
  onEdit?: (profile: UserCaptureProfile) => void
  onDelete?: (profileId: string) => void
  onNew?: () => void
}

const STOCK_IDS = ['standard', 'lite', 'feather', 'nano']
const EXTENDED_IDS = ['complex', 'revystd', 'revyhi', 'revxstd']

// Accent colors per built-in profile ID
const PROFILE_ACCENT: Record<string, { topBorder: string; dot: string }> = {
  standard: { topBorder: 'border-t-slate-400 dark:border-t-slate-500',    dot: 'bg-slate-400 dark:bg-slate-500' },
  lite:     { topBorder: 'border-t-emerald-400 dark:border-t-emerald-500', dot: 'bg-emerald-400 dark:bg-emerald-500' },
  feather:  { topBorder: 'border-t-sky-400 dark:border-t-sky-500',         dot: 'bg-sky-400 dark:bg-sky-500' },
  nano:     { topBorder: 'border-t-amber-400 dark:border-t-amber-500',     dot: 'bg-amber-400 dark:bg-amber-500' },
  complex:  { topBorder: 'border-t-blue-500 dark:border-t-blue-400',       dot: 'bg-blue-500 dark:bg-blue-400' },
  revystd:  { topBorder: 'border-t-violet-500 dark:border-t-violet-400',   dot: 'bg-violet-500 dark:bg-violet-400' },
  revyhi:   { topBorder: 'border-t-purple-500 dark:border-t-purple-400',   dot: 'bg-purple-500 dark:bg-purple-400' },
  revxstd:  { topBorder: 'border-t-fuchsia-500 dark:border-t-fuchsia-400', dot: 'bg-fuchsia-500 dark:bg-fuchsia-400' },
}

function ProfileCard({
  profile,
  selected,
  onToggle,
  onClone,
  onEdit,
  onDelete,
  accent,
}: {
  profile: CaptureProfile | UserCaptureProfile
  selected: boolean
  onToggle: () => void
  onClone?: () => void
  onEdit?: () => void
  onDelete?: () => void
  accent?: { topBorder: string; dot: string }
}) {
  const isBuiltIn = (profile as CaptureProfile).builtIn === true

  return (
    <div
      className={`relative group rounded-lg border cursor-pointer transition-all ${
        accent ? `border-t-2 ${accent.topBorder}` : ''
      } ${
        selected
          ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10 ring-1 ring-indigo-500/40'
          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-indigo-400 dark:hover:border-indigo-500/60'
      }`}
      onClick={onToggle}
    >
      <div className="px-3 py-2.5">
        <div className="flex items-start justify-between gap-1.5">
          <div className="min-w-0 flex items-start gap-1.5 flex-1">
            {accent && <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-[3px] ${accent.dot}`} />}
            <div className="min-w-0">
              <div className={`text-xs font-semibold truncate ${selected ? 'text-indigo-700 dark:text-indigo-200' : 'text-gray-900 dark:text-gray-100'}`}>
                {profile.name}
              </div>
              <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5 leading-tight line-clamp-2">
                {profile.description}
              </div>
            </div>
          </div>
          {selected && (
            <svg className="w-3.5 h-3.5 flex-shrink-0 text-indigo-600 dark:text-indigo-400 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          )}
        </div>
        <div className="mt-1.5 text-[10px] text-gray-400 dark:text-gray-500">
          {profile.lr} LR · {(profile as CaptureProfile).defaultEpochs ?? (profile as UserCaptureProfile).defaultEpochs} ep
        </div>
      </div>
      {/* Hover action icons */}
      <div
        className="absolute top-1.5 right-1.5 hidden group-hover:flex items-center gap-1"
        onClick={(e) => e.stopPropagation()}
      >
        {isBuiltIn && onClone && (
          <button
            title="Clone to custom profile"
            onClick={onClone}
            className="p-1 rounded bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors shadow-sm"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </button>
        )}
        {!isBuiltIn && onEdit && (
          <button
            title="Edit profile"
            onClick={onEdit}
            className="p-1 rounded bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors shadow-sm"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
        )}
        {!isBuiltIn && onDelete && (
          <button
            title="Delete profile"
            onClick={onDelete}
            className="p-1 rounded bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors shadow-sm"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}

export function ArchitectureProfilePicker({
  selectedIds,
  onChange,
  userProfiles,
  onClone,
  onEdit,
  onDelete,
  onNew,
}: ArchitectureProfilePickerProps) {
  const stockProfiles = BUILT_IN_CAPTURE_PROFILES.filter((p) => STOCK_IDS.includes(p.id))
  const extendedProfiles = BUILT_IN_CAPTURE_PROFILES.filter((p) => EXTENDED_IDS.includes(p.id))

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((s) => s !== id))
    } else {
      onChange([...selectedIds, id])
    }
  }

  const handleClone = (profile: CaptureProfile) => {
    if (onClone) onClone(profile)
  }

  const sectionLabel = (label: string) => (
    <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1.5 mt-3 first:mt-0">
      {label}
    </div>
  )

  return (
    <div>
      {sectionLabel('Built-in')}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {stockProfiles.map((profile) => (
          <ProfileCard
            key={profile.id}
            profile={profile}
            selected={selectedIds.includes(profile.id)}
            onToggle={() => toggle(profile.id)}
            onClone={onClone ? () => handleClone(profile) : undefined}
            accent={PROFILE_ACCENT[profile.id]}
          />
        ))}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
        {extendedProfiles.map((profile) => (
          <ProfileCard
            key={profile.id}
            profile={profile}
            selected={selectedIds.includes(profile.id)}
            onToggle={() => toggle(profile.id)}
            onClone={onClone ? () => handleClone(profile) : undefined}
            accent={PROFILE_ACCENT[profile.id]}
          />
        ))}
      </div>
      {sectionLabel('Custom Profiles')}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {userProfiles.map((profile) => (
          <ProfileCard
            key={profile.id}
            profile={{ ...profile, builtIn: false } as CaptureProfile}
            selected={selectedIds.includes(profile.id)}
            onToggle={() => toggle(profile.id)}
            onEdit={onEdit ? () => onEdit(profile) : undefined}
            onDelete={onDelete ? () => onDelete(profile.id) : undefined}
          />
        ))}
        {onNew && (
          <button
            onClick={onNew}
            className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 hover:border-indigo-400 dark:hover:border-indigo-500 bg-transparent hover:bg-indigo-50/50 dark:hover:bg-indigo-500/5 px-3 py-2.5 text-left transition-colors"
          >
            <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              New Profile
            </div>
          </button>
        )}
        {userProfiles.length === 0 && !onNew && (
          <div className="col-span-4 text-xs text-gray-400 dark:text-gray-500 italic py-1">
            No custom profiles yet.
          </div>
        )}
      </div>
    </div>
  )
}
