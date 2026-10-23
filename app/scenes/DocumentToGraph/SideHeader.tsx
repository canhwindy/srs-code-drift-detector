'use client'

import React from 'react'
import { useTranslation } from "react-i18next"

/**
 * SiteHeader Component
 *
 * A responsive navigation header for LightRAG application with tab navigation,
 * settings, and user authentication controls.
 *
 * Framework: Next.js 14+ (App Router)
 * Language: TypeScript
 * Styling: Tailwind CSS
 */

interface NavigationTab {
  id: string
  label: string
  value: string
}

interface SiteHeaderProps {
  /**
   * Currently active tab value — controlled by parent (index.tsx).
   * Must match one of the `value` fields in the `tabs` array.
   */
  activeTab: string

  /**
   * Called when user clicks a tab button.
   * Parent uses this to update its own activeTab state.
   */
  onTabChange: (tab: string) => void

  /** Application title displayed next to logo */
  appTitle?: string

  /** Application description shown in tooltip */
  appDescription?: string

  /** Current version of the core application */
  coreVersion?: string

  /** Current version of the API */
  apiVersion?: string

  /** Username of the currently logged-in user */
  username?: string

  /** Whether the user is in guest mode */
  isGuestMode?: boolean

  /** Show warning indicator on version badge */
  hasVersionWarning?: boolean

  /** GitHub repository URL */
  githubUrl?: string

  /** Navigation tabs to display — defaults to Documents/KnowledgeGraph/Retrieval/API */
  tabs?: NavigationTab[]

  /** Whether the header is in loading state */
  isLoading?: boolean
}

// ============================================================================
// Component
// ============================================================================

export default function SiteHeader({
  appTitle: _appTitle = 'Graph KB',
  appDescription: _appDescription = 'Knowledge Base Management System',
  coreVersion: _coreVersion = '1.4.10',
  apiVersion: _apiVersion = '2721',
  username: _username = 'User',
  isGuestMode = false,
  hasVersionWarning: _hasVersionWarning = false,
  githubUrl: _githubUrl = 'https://github.com/lightrag/lightrag',
  activeTab,
  onTabChange,
  tabs: tabsProp,
  isLoading = false,
}: SiteHeaderProps) {
  const { t } = useTranslation();

  const tabs = tabsProp ?? [
    { id: '1', label: t('Documents'), value: 'documents' },
    { id: '2', label: t('Sanitize Data'), value: 'sanitize-data' },
    { id: '3', label: t('Knowledge Graph'), value: 'knowledge-graph' },
  ];

  if (isLoading) {
    return (
      <header className="sticky top-0 z-50 flex h-14 w-full border-b border-gray-200 dark:border-[#2a2f3e] bg-white/95 dark:bg-[#111319]/95 backdrop-blur supports-[backdrop-filter]:bg-white/60 dark:supports-[backdrop-filter]:bg-[#111319]/60 px-4">
        <div className="flex-1 flex items-center justify-between animate-pulse">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-gray-300 dark:bg-[#2a2f3e] rounded" />
            <div className="h-4 w-24 bg-gray-300 dark:bg-[#2a2f3e] rounded" />
          </div>
          <div className="flex gap-2">
            <div className="h-8 w-20 bg-gray-300 dark:bg-[#2a2f3e] rounded" />
            <div className="h-8 w-32 bg-gray-300 dark:bg-[#2a2f3e] rounded" />
            <div className="h-8 w-20 bg-gray-300 dark:bg-[#2a2f3e] rounded" />
          </div>
          <div className="flex gap-2">
            <div className="w-8 h-8 bg-gray-300 dark:bg-[#2a2f3e] rounded" />
            <div className="w-8 h-8 bg-gray-300 dark:bg-[#2a2f3e] rounded" />
          </div>
        </div>
      </header>
    )
  }

  // ============================================================================
  // Main Render
  // ============================================================================

  return (
    <header
      className="sticky top-0 z-50 flex h-14 w-full border-b border-gray-200 dark:border-[#2a2f3e] bg-white/95 dark:bg-[#111319]/95 backdrop-blur supports-[backdrop-filter]:bg-white/60 dark:supports-[backdrop-filter]:bg-[#111319]/60 px-4"
      role="banner"
      aria-label="Site header"
    >
      {/* Left spacer */}
      <div className="min-w-[200px] w-auto flex items-center" />

      {/* Center — Navigation Tabs */}
      <div className="flex h-14 flex-1 items-center justify-center">
        <nav
          className="flex h-9 self-center"
          role="navigation"
          aria-label="Main navigation"
        >
          <div className="h-full flex gap-1 p-1 bg-gray-100 dark:bg-[#1f232e] rounded-lg">
            {tabs.map((tab: NavigationTab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => onTabChange(tab.value)}
                className={`
                  px-4 py-1.5 rounded-md text-sm font-medium transition-all duration-150 cursor-pointer
                  focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-1
                  ${activeTab === tab.value
                    ? 'bg-emerald-400 text-white shadow-sm'
                    : 'text-gray-600 dark:text-[#E6E6E6] hover:bg-white/70 dark:hover:bg-[#2a2f3e]/70'
                  }
                `}
                aria-current={activeTab === tab.value ? 'page' : undefined}
                aria-label={`Navigate to ${tab.label}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </nav>

        {/* Guest Mode Badge */}
        {isGuestMode && (
          <div
            className="ml-3 self-center px-3 py-1 text-xs bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 rounded-md font-medium"
            role="status"
            aria-label="Guest mode active"
          >
            {t("Guest Mode")}
          </div>
        )}
      </div>

      {/* Right spacer */}
      <div className="min-w-[200px]" />
    </header>
  )
}

