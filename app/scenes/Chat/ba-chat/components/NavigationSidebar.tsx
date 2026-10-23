import { useState, useRef, useEffect } from 'react';
import type { MenuItem } from '../types';
import { Plus, MessageSquare, FolderKanban, FileText, Code, User, MoreHorizontal, Monitor, Moon, Sun } from 'lucide-react';

export type ThemeMode = 'light' | 'dark' | 'system';

interface NavigationSidebarProps {
  menuItems: MenuItem[];
  onNewChat: () => void;
  theme?: ThemeMode;
  onThemeChange?: (theme: ThemeMode) => void;
}

const iconMap = {
  dashboard: FolderKanban,
  srs: FileText,
  'code-mapping': Code,
  chat: MessageSquare,
};

export function NavigationSidebar({ menuItems, onNewChat, theme = 'light', onThemeChange }: NavigationSidebarProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isAppearanceOpen, setIsAppearanceOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
        setIsAppearanceOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const themeOptions: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Monitor },
  ];

  return (
    <div className="w-[260px] bg-slate-900 text-white flex flex-col h-screen flex-shrink-0 border-r border-slate-800">
      {/* New Chat Button */}
      <div className="p-3">
        <button
          onClick={onNewChat}
          aria-label="New chat"
          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors duration-200 cursor-pointer shadow-sm"
        >
          <Plus className="w-4 h-4" />
          <span>New chat</span>
        </button>
      </div>

      {/* Menu Items */}
      <nav className="px-3 pb-3 border-b border-slate-800">
        <div className="space-y-0.5">
          {menuItems.map((item) => {
            const Icon = iconMap[item.id as keyof typeof iconMap];
            return (
              <button
                key={item.id}
                onClick={item.onClick}
                aria-label={item.label}
                aria-current={item.isActive ? 'page' : undefined}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-normal transition-colors duration-200 cursor-pointer ${
                  item.isActive
                    ? 'bg-slate-800 text-blue-400'
                    : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
                }`}
              >
                {Icon && <Icon className="w-4 h-4 flex-shrink-0" />}
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Spacer */}
      <div className="flex-1" />

      {/* User Section */}
      <div className="p-3 border-t border-slate-800 relative" ref={menuRef}>
        <div className="flex items-center gap-1">
          <button
            aria-label="User settings"
            className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-normal text-slate-400 hover:bg-slate-800/50 hover:text-slate-200 transition-colors duration-200 cursor-pointer"
          >
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center flex-shrink-0 shadow-sm">
              <User className="w-4 h-4 text-white" />
            </div>
            <span className="truncate">User Account</span>
          </button>

          {/* "..." button */}
          <button
            onClick={() => {
              setIsMenuOpen((v) => !v);
              setIsAppearanceOpen(false);
            }}
            aria-label="More options"
            className="p-1.5 rounded-md text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors duration-150 cursor-pointer flex-shrink-0"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </div>

        {/* Popup menu */}
        {isMenuOpen && (
          <div className="absolute bottom-full left-3 right-3 mb-1 bg-slate-800 border border-slate-700 rounded-xl shadow-xl z-50 py-1 overflow-hidden">
            {!isAppearanceOpen ? (
              /* Main menu */
              <button
                onClick={() => setIsAppearanceOpen(true)}
                className="w-full text-left px-4 py-2.5 text-[13px] text-slate-300 hover:bg-slate-700 hover:text-white transition-colors cursor-pointer flex items-center gap-2"
              >
                {theme === 'dark' ? <Moon className="w-3.5 h-3.5" /> : theme === 'system' ? <Monitor className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
                <span>Appearance</span>
                <span className="ml-auto text-[11px] text-slate-500 capitalize">{theme}</span>
              </button>
            ) : (
              /* Appearance submenu */
              <>
                <div className="px-4 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                  Appearance
                </div>
                {themeOptions.map((opt) => {
                  const Icon = opt.icon;
                  const isActive = theme === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => {
                        onThemeChange?.(opt.value);
                        setIsMenuOpen(false);
                        setIsAppearanceOpen(false);
                      }}
                      className={`w-full text-left px-4 py-2 text-[13px] hover:bg-slate-700 transition-colors cursor-pointer flex items-center gap-2 ${
                        isActive ? 'text-blue-400' : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>{opt.label}</span>
                      {isActive && <span className="ml-auto text-blue-400 text-[11px]">✓</span>}
                    </button>
                  );
                })}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
