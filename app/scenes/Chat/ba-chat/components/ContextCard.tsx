import type { ContextCard as ContextCardType } from '../types';
import { FileText, ArrowRight, AlertCircle, CheckCircle, XCircle, Info } from 'lucide-react';

interface ContextCardProps {
  card: ContextCardType;
}

export function ContextCard({ card }: ContextCardProps) {
  const badgeConfig = {
    orange: {
      bg: 'bg-orange-50',
      text: 'text-orange-700',
      border: 'border-orange-200',
      icon: AlertCircle,
    },
    green: {
      bg: 'bg-green-50',
      text: 'text-green-700',
      border: 'border-green-200',
      icon: CheckCircle,
    },
    red: {
      bg: 'bg-red-50',
      text: 'text-red-700',
      border: 'border-red-200',
      icon: XCircle,
    },
    blue: {
      bg: 'bg-blue-50',
      text: 'text-blue-700',
      border: 'border-blue-200',
      icon: Info,
    },
  };

  const config = badgeConfig[card.statusBadge.color];
  const BadgeIcon = config.icon;

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3 w-full shadow-sm">
      <div className="flex items-start gap-2.5 mb-2">
        <div className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
          <FileText className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-[13px] text-slate-900 dark:text-slate-100 mb-1">{card.title}</h4>
          <span
            className={`inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-md font-medium border ${config.bg} ${config.text} ${config.border}`}
          >
            <BadgeIcon className="w-3 h-3" />
            {card.statusBadge.text}
          </span>
        </div>
      </div>

      <p className="text-[11px] text-slate-600 dark:text-slate-400 mb-2">
        Last updated: {card.lastUpdated} by {card.updatedBy}
      </p>

      <a
        href={card.linkUrl}
        className="text-[11px] text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium inline-flex items-center gap-1 hover:gap-1.5 transition-all duration-200"
      >
        {card.linkText}
        <ArrowRight className="w-3 h-3" />
      </a>
    </div>
  );
}
