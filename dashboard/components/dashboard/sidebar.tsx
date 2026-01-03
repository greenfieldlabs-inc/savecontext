'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Database, LayoutDashboard, FolderKanban, Bookmark, Brain, CheckSquare, FileText, PanelLeftOpen, PanelLeftClose, Menu } from 'lucide-react';
import { cn } from '@/lib/utils';

const navigationSections = [
  {
    items: [
      { name: 'Projects', href: '/dashboard', icon: LayoutDashboard },
      { name: 'Sessions', href: '/dashboard/sessions', icon: FolderKanban },
      { name: 'Checkpoints', href: '/dashboard/checkpoints', icon: Bookmark },
    ]
  },
  {
    items: [
      { name: 'Memory', href: '/dashboard/memory', icon: Brain },
      { name: 'Issues', href: '/dashboard/issues', icon: CheckSquare },
      { name: 'Plans', href: '/dashboard/plans', icon: FileText },
    ]
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  useEffect(() => {
    setIsMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024) {
        setIsMobileOpen(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (isMobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isMobileOpen]);

  const SidebarContent = ({ mobile = false }: { mobile?: boolean }) => (
    <>
      {/* Logo */}
      <div className="flex h-16 items-center justify-between border-b border-zinc-200 px-4 dark:border-zinc-800">
        {isCollapsed && !mobile ? (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-black dark:bg-white">
            <Database className="h-5 w-5 text-white dark:text-black" />
          </div>
        ) : (
          <div className="flex items-center gap-3 bg-white/50 px-3 py-2 rounded-xl flex-1 dark:bg-zinc-800/50">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-black dark:bg-white">
              <Database className="h-5 w-5 text-white dark:text-black" />
            </div>
            <span className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">SaveContext</span>
          </div>
        )}
        {mobile && (
          <button
            onClick={() => setIsMobileOpen(false)}
            className="ml-2 flex h-8 w-8 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
            aria-label="Close menu"
          >
            <PanelLeftClose className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        {navigationSections.map((section, sectionIndex) => (
          <div
            key={sectionIndex}
            className={cn(
              'space-y-1',
              sectionIndex > 0 && 'mt-6 border-t border-zinc-200 pt-6 dark:border-zinc-800'
            )}
          >
            {section.items.map((item) => {
              const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
              const Icon = item.icon;

              return (
                <Link
                  key={item.name}
                  href={item.href}
                  onClick={() => mobile && setIsMobileOpen(false)}
                  className={cn(
                    'group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
                    isActive
                      ? 'bg-[rgb(var(--sidebar-primary))] text-[rgb(var(--sidebar-primary-foreground))] shadow-sm'
                      : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800',
                    isCollapsed && !mobile && 'justify-center'
                  )}
                  title={isCollapsed && !mobile ? item.name : undefined}
                >
                  <Icon className={cn(
                    'h-5 w-5 shrink-0 transition-colors',
                    isActive
                      ? 'text-[rgb(var(--sidebar-primary-foreground))]'
                      : 'text-zinc-500 group-hover:text-zinc-700 dark:text-zinc-400 dark:group-hover:text-zinc-300'
                  )} />
                  {(!isCollapsed || mobile) && item.name}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Collapse/Expand Button - Desktop only */}
      {!mobile && (
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="absolute -right-4 bottom-6 z-50 hidden lg:flex h-8 w-8 items-center justify-center rounded-full border border-zinc-200 bg-white shadow-sm transition-all hover:shadow-md dark:border-zinc-700 dark:bg-zinc-800"
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {isCollapsed ? (
            <PanelLeftOpen className="h-5 w-5 text-zinc-600 dark:text-zinc-400" />
          ) : (
            <PanelLeftClose className="h-5 w-5 text-zinc-600 dark:text-zinc-400" />
          )}
        </button>
      )}
    </>
  );

  return (
    <>
      {/* Mobile Menu Button */}
      <button
        onClick={() => setIsMobileOpen(true)}
        className="fixed left-4 top-4 z-50 flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-200 bg-white shadow-sm lg:hidden dark:border-zinc-700 dark:bg-zinc-800"
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5 text-zinc-600 dark:text-zinc-400" />
      </button>

      {/* Mobile Overlay */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      {/* Mobile Sidebar Drawer */}
      <div className={cn(
        "fixed inset-y-0 left-0 z-50 w-72 transform bg-zinc-50 transition-transform duration-300 ease-in-out lg:hidden dark:bg-zinc-900",
        isMobileOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="flex h-full flex-col">
          <SidebarContent mobile />
        </div>
      </div>

      {/* Desktop Sidebar */}
      <div className={cn(
        "relative hidden lg:flex h-screen flex-col border-r border-zinc-200 bg-zinc-50 transition-all duration-300 dark:border-zinc-800 dark:bg-zinc-900",
        isCollapsed ? "w-20" : "w-64"
      )}>
        <SidebarContent />
      </div>
    </>
  );
}
