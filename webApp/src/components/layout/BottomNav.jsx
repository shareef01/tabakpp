import React from 'react';
import { motion } from 'framer-motion';
import { LayoutGrid, BarChart3, Settings } from 'lucide-react';
import { cn } from '../../utils/utils';

/**
 * Bottom Navigation Dock - PLATINUM REFINED PILL
 * Widened footprint with solid grounding to prevent grid-bleed.
 */
export const BottomNav = React.memo(({ activeTab, onTabChange }) => {
  const tabs = [
    { id: 'track', icon: LayoutGrid, label: 'Track' },
    { id: 'history', icon: BarChart3, label: 'History' },
    { id: 'settings', icon: Settings, label: 'Settings' }
  ];

  const activeIndex = tabs.findIndex(t => t.id === activeTab);

  return (
    <nav
      aria-label="Main navigation"
      className="fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] md:bottom-[max(2rem,env(safe-area-inset-bottom))] left-0 right-0 z-100 px-4 pointer-events-none"
    >
      <div className="w-full max-w-[340px] md:max-w-[370px] mx-auto h-[62px] md:h-16 bg-bg-panel/95 backdrop-blur-xl border border-white/[0.1] rounded-full shadow-[0_24px_64px_rgba(0,0,0,0.9)] p-1.5 flex items-center relative pointer-events-auto ring-1 ring-white/[0.04]">

        {/* SLIDING ACTIVE INDICATOR */}
        <motion.div
          className="absolute left-1.5 top-1.5 h-[calc(100%-12px)] rounded-full bg-white/[0.07] border border-white/[0.12] shadow-inner"
          initial={false}
          animate={{
            x: `${activeIndex * 100}%`,
          }}
          transition={{ type: "spring", stiffness: 500, damping: 36 }}
          style={{ width: `calc((100% - 12px) / ${tabs.length})` }}
        >
          {/* Neon Under-glow */}
          <div className="absolute inset-0 bg-accent opacity-[0.12] rounded-full blur-md" />
        </motion.div>

        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const Icon = tab.icon;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={cn(
                "flex-1 h-full min-h-11 flex flex-col items-center justify-center gap-0.5 relative z-10 rounded-full transition-all duration-200 active:scale-95 touch-manipulation outline-hidden",
                "focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-panel"
              )}
              aria-label={tab.label}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon
                size={isActive ? 20 : 18}
                strokeWidth={isActive ? 2.5 : 2}
                className={cn(
                  "transition-all duration-300 shrink-0",
                  isActive
                    ? "text-accent drop-shadow-[0_0_12px_rgba(var(--accent-rgb),0.55)]"
                    : "text-neutral-400 group-hover:text-neutral-200"
                )}
                aria-hidden="true"
              />
              <span
                className={cn(
                  "text-[11px] leading-none transition-colors duration-200 select-none",
                  isActive ? "text-white font-bold" : "text-neutral-400 font-medium"
                )}
              >
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
});
