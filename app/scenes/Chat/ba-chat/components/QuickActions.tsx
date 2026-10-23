import type { QuickAction } from '../types';
import { CheckSquare, Sparkles, GitPullRequest, FileText } from 'lucide-react';

interface QuickActionsProps {
  actions: QuickAction[];
}

const iconMap = {
  '1': CheckSquare,
  '2': Sparkles,
  '3': GitPullRequest,
  '4': FileText,
};

export function QuickActions({ actions }: QuickActionsProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh]">
      <div className="text-center mb-8">
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-2">How can I help you today?</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">Choose a quick action or start typing your question</p>
      </div>
      <div className="grid grid-cols-2 gap-3 max-w-2xl w-full">
        {actions.map((action) => {
          const Icon = iconMap[action.id as keyof typeof iconMap];
          return (
            <button
              key={action.id}
              onClick={action.onClick}
              aria-label={action.title}
              className="text-left p-4 border border-slate-200 dark:border-slate-700 rounded-xl hover:border-blue-300 dark:hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-slate-800 transition-all duration-200 cursor-pointer group shadow-sm hover:shadow-md"
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center flex-shrink-0 group-hover:bg-blue-200 dark:group-hover:bg-blue-900/60 transition-colors">
                  {Icon && <Icon className="w-5 h-5 text-blue-600" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-slate-900 dark:text-slate-100 mb-1">{action.title}</p>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">{action.description}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
