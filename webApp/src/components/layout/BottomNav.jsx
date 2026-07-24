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
    <nav className="fixed bottom-[max(1.5rem,env(safe-area-inset-bottom))] md:bottom-[max(2.5rem,env(safe-area-inset-bottom))] left-0 right-0 z-[100] px-6 pointer-events-none">
      <div className="max-w-[320px] mx-auto h-16 md:h-18 bg-bg-panel border border-white/[0.08] rounded-full shadow-[0_40px_100px_rgba(0,0,0,1)] p-1.5 flex items-center relative pointer-events-auto ring-1 ring-white/[0.02]">

        {/* SLIDING ACTIVE INDICATOR */}
        <motion.div
          className="absolute left-1.5 top-1.5 h-[calc(100%-12px)] rounded-full bg-white/[0.05] border border-white/[0.08] shadow-inner"
          initial={false}
          animate={{
            x: `${activeIndex * 100}%`,
          }}
          transition={{ type: "spring", stiffness: 500, damping: 35 }}
          style={{ width: `calc((100% - 12px) / ${tabs.length})` }}
        >
          {/* Neon Under-glow */}
          <div className="absolute inset-0 bg-accent opacity-[0.1] rounded-full blur-md" />
        </motion.div>

        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const Icon = tab.icon;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className="flex-1 h-full flex items-center justify-center relative z-10 transition-all duration-300 active:scale-90 touch-manipulation"
              aria-label={tab.label}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon
                size={isActive ? 24 : 22}
                strokeWidth={isActive ? 2.5 : 2}
                className={cn(
                  "transition-all duration-500",
                  isActive ? "text-accent drop-shadow-[0_0_15px_var(--accent-rgb)]" : "text-neutral-400 hover:text-neutral-200"
                )}
              />
              <span className="sr-only">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
});
