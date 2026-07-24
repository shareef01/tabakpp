import React from 'react';
import { cn } from '../../utils/utils';

/**
 * DashboardSkeleton
 * High-fidelity placeholder that matches the 4-column grid layout perfectly.
 * Prevents layout shift during post-login data hydration.
 */
export const DashboardSkeleton = React.memo(({ widgetSize }) => {
  const gridClasses = {
    SMALL: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4",
    MEDIUM: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4",
    LARGE: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4"
  };

  const heights = {
    SMALL: "min-h-[260px]",
    MEDIUM: "min-h-[300px]",
    LARGE: "min-h-[340px]"
  };

  return (
    <div role="status" aria-label="Loading screen" className="space-y-4 md:space-y-5 animate-pulse">
      <div className={cn("grid", gridClasses[widgetSize] || gridClasses.LARGE)}>
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className={cn(
              "bg-neutral-800/10 border border-white/5 rounded-3xl",
              heights[widgetSize] || heights.LARGE
            )}
          />
        ))}
      </div>
      <div className="w-full h-40 bg-neutral-800/10 border border-white/5 rounded-[48px]" />
    </div>
  );
});
