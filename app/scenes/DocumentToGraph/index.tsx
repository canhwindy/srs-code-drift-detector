import { useState } from "react";
import { useTranslation } from "react-i18next";
import useStores from "~/hooks/useStores";
import DocumentManager from "./DocumentManagers";
import SiteHeader from "./SideHeader";
import KnowledgeGraphViewer from './KnowledgeGraphViewer'
import SanitizeData from "./SanitizeData";

export default function Home(): React.JSX.Element {
  const { t } = useTranslation();
  const { auth } = useStores();
  const workspaceId = auth.currentTeamId ?? "";

  const [activeTab, setActiveTab] = useState<string>('documents')

  return (
    <div className="w-full min-h-screen bg-white dark:bg-[#111319] pl-8 pr-8">
      {/* SiteHeader is now a controlled component:
          - activeTab: which tab is highlighted (green)
          - onTabChange: called when user clicks a tab button */}
      <SiteHeader
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      {/* Tab Content — only the active tab renders */}
      <div className="p-6">

        {/* Documents Tab */}
        {activeTab === 'documents' && (
          <DocumentManager workspaceId={workspaceId} />
        )}

        {/* Sanitize Data Tab */}
        {activeTab === 'sanitize-data' && (
          <SanitizeData workspaceId={workspaceId} />
        )}

        {/* Knowledge Graph Tab */}
        {activeTab === 'knowledge-graph' && (
          <KnowledgeGraphViewer workspaceId={workspaceId} />
        )}

        {/* Retrieval Tab — placeholder */}
        {activeTab === 'retrieval' && (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <svg className="w-10 h-10 text-gray-300 dark:text-[#2a2f3e]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
            </svg>
            <p className="text-sm font-medium text-gray-400 dark:text-[#4a5568]">{t("Retrieval — coming soon")}</p>
          </div>
        )}

        {/* API Tab — placeholder */}
        {activeTab === 'api' && (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <svg className="w-10 h-10 text-gray-300 dark:text-[#2a2f3e]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5" />
            </svg>
            <p className="text-sm font-medium text-gray-400 dark:text-[#4a5568]">{t("API — coming soon")}</p>
          </div>
        )}

      </div>
    </div>
  )
}
