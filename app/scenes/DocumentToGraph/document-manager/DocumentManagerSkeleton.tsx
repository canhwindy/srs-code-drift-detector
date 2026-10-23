export default function DocumentManagerSkeleton() {
    return (
        <div className="flex flex-col h-full min-h-0 bg-white dark:bg-[#111319] rounded-lg border border-gray-200 dark:border-[#2a2f3e] shadow-sm">
            <div className="py-3 px-6 border-b border-gray-200 dark:border-[#2a2f3e]">
                <div className="h-6 w-48 bg-gray-300 dark:bg-[#2a2f3e] rounded animate-pulse" />
            </div>
            <div className="flex-1 p-6 space-y-4">
                <div className="flex gap-2">
                    <div className="h-9 w-32 bg-gray-300 dark:bg-[#2a2f3e] rounded animate-pulse" />
                    <div className="h-9 w-32 bg-gray-300 dark:bg-[#2a2f3e] rounded animate-pulse" />
                </div>
                <div className="h-64 bg-gray-300 dark:bg-[#2a2f3e] rounded animate-pulse" />
            </div>
        </div>
    )
}
