import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, CircleDot, X } from 'lucide-react';
import { cn } from '../../utils/utils';
import { Card } from '../Common';

/**
 * State-driven Getting Started card.
 *
 * Derives its checklist from SmokingCalculator.getFirstWeekGuidance (item 27)
 * — no separate onboarding-persisted flag. Disappears automatically once
 * tracking evidence exists (stage >= 2). Optionally dismissible via onDismiss.
 *
 * Shows:
 *   ✓ Tracker created
 *   ✓ Daily target set
 *   ○ Record your first activity
 *
 * Plus a hint line explaining what the target means (item 12).
 */
export const GettingStartedCard = React.memo(({ onboarding, onDismiss }) => {
  if (onboarding?.hasTrackingEvidence) return null;

  return (
    <AnimatePresence>
      <motion.div
        key="getting-started"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.3 }}
        className="mb-4"
      >
        <Card className="relative">
          <div className="flex items-center justify-between mb-4">
            <span className="text-[11px] font-black uppercase tracking-[0.2em] text-neutral-400">
              GETTING STARTED
            </span>
            {onDismiss && (
              <button
                type="button"
                onClick={onDismiss}
                aria-label="Dismiss getting started"
                className="p-1 text-neutral-500 hover:text-neutral-300 transition-colors touch-manipulation"
              >
                <X size={16} strokeWidth={2} />
              </button>
            )}
          </div>

          <div className="space-y-3">
            <Step
              icon={onboarding?.hasTracker ? <CheckCircle2 size={18} className="text-accent" /> : <CircleDot size={18} className="text-neutral-600" />}
              label="Tracker created"
              complete={!!onboarding?.hasTracker}
            />
            <Step
              icon={onboarding?.hasTracker ? <CheckCircle2 size={18} className="text-accent" /> : <CircleDot size={18} className="text-neutral-600" />}
              label="Daily target set"
              complete={!!onboarding?.hasTracker}
            />
            <Step
              icon={<CircleDot size={18} className="text-neutral-600" />}
              label="Record your first activity"
              complete={false}
            />
          </div>

          <p className="mt-4 text-xs text-neutral-500">
            Your target is the daily level you want to stay at or below.
          </p>
        </Card>
      </motion.div>
    </AnimatePresence>
  );
});

const Step = ({ icon, label, complete }) => (
  <div className="flex items-center gap-3">
    <span className="shrink-0">{icon}</span>
    <span className={cn(
      'text-sm font-black',
      complete ? 'text-white' : 'text-neutral-500'
    )}>
      {label}
    </span>
  </div>
);
