import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '../../utils/utils';

/**
 * SHARED DESIGN TOKENS
 */
const BURN_TRANSITION = { duration: 0.8, ease: [0.16, 1, 0.3, 1] };

/**
 * RECESSED INDUSTRIAL GAUGE - PLATINUM UNIFIED
 * 1. Physical Slot: Deep-set recessed container.
 * 2. Textured Verge: Vertical material lines on paper.
 * 3. Laser Ember: Sharp vertical neon ignition strip.
 */
export const CigaretteGauge = React.memo(({ count = 0, limit = 1, type, isLarge }) => {
  const progress = Math.min(1, count / (limit || 1));
  // Slightly longer filter → shorter paper body for a stubbier silhouette
  const filterRatio = 0.3;
  const filterPercent = filterRatio * 100;
  const burnablePercent = 100 - filterPercent;

  // Precise Ignition State Logic
  const ignited = (count >= limit) && (limit > 0);
  const paperColor = 'bg-[#FAFAFA]';
  const filterColors = 'bg-gradient-to-b from-[#F4A261] to-[#E76F3C]';

  return (
    <div className={cn(
      "relative w-full max-w-[220px] mx-auto rounded-full bg-black/40 border border-white/[0.08] shadow-inner p-1.5 overflow-hidden transition-all duration-700",
      isLarge ? "h-16 md:h-[4.5rem]" : "h-14 md:h-16",
      ignited && "border-red-500/20 bg-red-950/20"
    )}>
      {/* THE INNER TRACK */}
      <div className="relative w-full h-full rounded-full overflow-hidden flex items-center bg-black/20">

        {/* TOTAL IGNITION STATE */}
        {ignited && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 bg-danger shadow-[0_0_30px_rgba(255,17,17,0.4)] z-50"
          />
        )}

        {/* 1. ASH MODULE */}
        <motion.div
          initial={false}
          animate={{ width: `${progress * burnablePercent}%` }}
          transition={BURN_TRANSITION}
          className="h-full bg-[#1A1A1A] relative z-20 shadow-[inset_-5px_0_10px_rgba(0,0,0,0.5)]"
        >
          {/* LASER EMBER STRIP */}
          {!ignited && progress > 0 && (
            <div className="absolute right-0 top-0 bottom-0 w-1.5 bg-[#FF4500] shadow-[0_0_15px_#FF4500] z-30 border-x border-orange-400/20" />
          )}
        </motion.div>

        {/* 2. PAPER MODULE (Textured Verge) */}
        <div className={cn("flex-1 h-full relative overflow-hidden", paperColor)}>
          {!ignited && (
            <div className="absolute inset-0 opacity-[0.04] pointer-events-none flex justify-around">
              {Array.from({ length: 15 }).map((_, i) => (
                <div key={i} className="w-[1px] h-full bg-black" />
              ))}
            </div>
          )}
          {/* Surface Rounding Shading */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/20 pointer-events-none" />
        </div>

        {/* 3. FILTER MODULE */}
        <div
          className={cn("h-full border-l border-black/40 relative", filterColors)}
          style={{ width: `${filterPercent}%` }}
        >
          {/* Surface Rounding Shading */}
          <div className="absolute inset-0 bg-gradient-to-b from-white/10 via-transparent to-black/30 pointer-events-none" />
        </div>
      </div>
    </div>
  );
});

// Legacy adapters for existing code structure if needed
export const ZigProgress = (props) => <CigaretteGauge {...props} type="CIGARETTE" />;
export const KngProgress = (props) => <CigaretteGauge {...props} type="JOINT_KING" />;
export const RyoRollProgress = (props) => <CigaretteGauge {...props} type="RYO_ROLL" />;
export const SmokingProgress = (props) => <CigaretteGauge {...props} />;
export const RingProgress = (props) => <CigaretteGauge {...props} type="SIMPLE" />;
