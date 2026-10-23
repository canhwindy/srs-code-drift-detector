export function TypingIndicator() {
  return (
    <div className="mb-10 w-full">
      <div className="text-[11px] text-slate-400 dark:text-slate-500 mb-3">BA Agent</div>
      <div className="flex items-center gap-2">
        <div className="flex gap-1.5">
          <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
          <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
          <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
        <span className="text-sm text-slate-500">Thinking...</span>
      </div>
    </div>
  );
}
