import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '../utils/utils';

/**
 * UI Constants for Platinum Industrial Design
 */
export const UI = {
  CARD: "bg-bg-card border border-white/[0.05] rounded-card transition-all duration-500 ease-out shadow-2xl shadow-black ring-1 ring-white/[0.03]",
  INPUT: "h-14 px-6 rounded-2xl border bg-bg-base border-white/[0.08] text-white placeholder:text-neutral-700 font-medium text-base focus:ring-1 focus:ring-accent/40 outline-none transition-all duration-300",
  BUTTON_BASE: "min-h-[56px] px-8 rounded-2xl font-black uppercase tracking-widest flex items-center justify-center transition-all duration-300 ease-out active:scale-[0.94] disabled:opacity-40 select-none touch-manipulation",
  LABEL: "block mb-2 ml-1 text-[11px] font-black text-neutral-400 uppercase tracking-[0.16em] antialiased",
  GLASS_ACTION: "flex items-center justify-center min-h-[48px] min-w-[48px] p-3 rounded-xl bg-white/[0.03] border border-white/[0.05] text-neutral-400 hover:text-white hover:bg-white/[0.06] active:scale-90 transition-all duration-300"
};

/**
 * TABAK++ LOGO IDENTITY - PLATINUM UNIFIED
 * Industrial Logotype with Black weight and negative kerning.
 */
export const Logo = React.memo(({ size = 'md', className }) => {
  const sizes = {
    sm: { t: "text-2xl", plus: "text-xl", gap: "gap-1" },
    md: { t: "text-4xl", plus: "text-3xl", gap: "gap-1.5" },
    lg: { t: "text-7xl", plus: "text-6xl", gap: "gap-2" }
  };
  const s = sizes[size] || sizes.md;

  return (
    <div className={cn("flex items-center group select-none cursor-default antialiased", className)}>
      <span className={cn(
        "font-black text-white leading-none lowercase tracking-[-0.05em] transition-transform duration-500 group-hover:scale-105",
        s.t
      )}>
        t
      </span>
      <span className={cn(
        "font-black text-accent leading-none transition-transform duration-500 delay-75 group-hover:scale-110",
        s.plus
      )}>
        ++
      </span>
    </div>
  );
});

export const Card = React.memo(({ children, className, danger, noPadding }) => (
  <div className={cn(
    UI.CARD,
    !noPadding && "p-6 md:p-10",
    danger && "bg-red-950/10 border-red-500/20",
    "will-change-[border-color,background-color,transform] relative overflow-hidden",
    className
  )}>
    {/* 0.5dp Milled Top Highlight */}
    <div className="absolute top-0 left-0 right-0 h-[1px] bg-white/[0.04] pointer-events-none" />
    {children}
  </div>
));

export const Button = React.memo(({ children, onClick, className, variant = 'primary', disabled, size = 'md', style, type = "button" }) => {
  const variants = {
    primary: "bg-accent/10 text-accent border border-accent/30 shadow-lg shadow-accent/5 hover:bg-accent/15",
    secondary: "bg-white/[0.04] text-white border border-white/[0.08] hover:bg-white/[0.06]",
    danger: "bg-red-600 text-white shadow-lg shadow-red-600/20",
    ghost: "bg-transparent text-neutral-500 hover:text-white hover:bg-white/5",
    outline: "bg-transparent border-2 border-accent/20 text-inherit hover:border-accent/40 hover:bg-accent/5"
  };

  const sizes = {
    sm: "h-11 px-6 text-xs",
    md: "h-14 px-10 text-xs",
    lg: "h-16 px-12 text-sm"
  };

  return (
    <motion.button
      type={type}
      whileTap={{ scale: 0.95 }}
      disabled={disabled}
      onClick={onClick}
      style={style}
      className={cn(
        UI.BUTTON_BASE,
        variants[variant],
        sizes[size],
        className
      )}
    >
      <span className="relative z-10 flex items-center gap-3">{children}</span>
    </motion.button>
  );
});

export const Input = React.memo(({ value, onChange, label, type = "text", placeholder, isDark, className, required, id, ...props }) => {
  const inputId = id || (label ? `field-${String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : undefined);
  return (
    <div className={cn("flex flex-col w-full", className)}>
      {label && (
        <label htmlFor={inputId} className={cn(UI.LABEL)}>
          {label}
        </label>
      )}
      <input
        id={inputId}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className={cn(
          UI.INPUT,
          !isDark && "bg-bg-base/40"
        )}
        {...props}
      />
    </div>
  );
});
