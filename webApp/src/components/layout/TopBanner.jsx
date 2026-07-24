import { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import { User, LogOut, Layout, Settings, ChevronDown, Square, Columns2, LayoutGrid, BarChart3 } from 'lucide-react';
import { cn } from '../../utils/utils';
import { Logo } from '../Common';

/** Compact → comfortable → spacious (matches TrackerCard density). */
const DENSITY_OPTIONS = [
  { id: 'SMALL', icon: LayoutGrid, label: 'Compact' },
  { id: 'MEDIUM', icon: Columns2, label: 'Comfortable' },
  { id: 'LARGE', icon: Square, label: 'Spacious' },
];

const initialsFrom = (name, email) => {
  const source = (name || email || '').trim();
  if (!source) return '';
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return source.slice(0, 2).toUpperCase();
};

const AvatarFace = ({ user, size = 'md', className }) => {
  const dims = size === 'lg' ? 'w-10 h-10 text-[11px]' : 'w-8 h-8 text-[10px]';
  const initials = initialsFrom(user?.displayName, user?.email);
  return (
    <div
      className={cn(
        'relative flex items-center justify-center overflow-hidden rounded-full bg-[#0a0a0c] ring-1 ring-inset ring-white/[0.08]',
        dims,
        className
      )}
    >
      {user?.photoURL ? (
        <img src={user.photoURL} alt="" className="object-cover w-full h-full" />
      ) : initials ? (
        <span className="font-black tracking-tight text-accent leading-none">{initials}</span>
      ) : (
        <User size={size === 'lg' ? 18 : 15} className="text-accent" strokeWidth={2.25} />
      )}
    </div>
  );
};

/**
 * TopBanner - PLATINUM GROUNDED BAR
 * Full-width industrial command center with absolute grounding.
 */
export const TopBanner = ({ user, onNavigate, widgetSize, onUpdateSettings, onRequestLogout }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);
  const activeDensity = DENSITY_OPTIONS.some((o) => o.id === widgetSize) ? widgetSize : 'MEDIUM';
  const shortName = useMemo(() => {
    const raw = (user?.displayName || user?.email || '').trim();
    if (!raw) return null;
    if (raw.includes('@')) return raw.split('@')[0];
    return raw.split(/\s+/)[0];
  }, [user?.displayName, user?.email]);

  useEffect(() => {
    const clickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setIsOpen(false);
    };
    document.addEventListener('pointerdown', clickOutside);
    return () => document.removeEventListener('pointerdown', clickOutside);
  }, []);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen]);

  return (
    <header className="w-full bg-bg-panel border-b border-white/[0.05] shadow-2xl">
      <div className="w-full h-16 md:h-20 flex items-center justify-between px-6 md:px-12 lg:px-16 mx-auto">

        {/* LOGO IDENTITY */}
        <Logo size="sm" className="scale-90 md:scale-100 origin-left" />

        <div className="flex items-center gap-4 md:gap-8">
          {/* CARD DENSITY */}
          <LayoutGroup id="density-toggle">
            <div
              role="radiogroup"
              aria-label="Card density"
              className="hidden md:flex items-center p-0.5 gap-0.5 rounded-full bg-white/[0.03] ring-1 ring-inset ring-white/[0.06]"
            >
              {DENSITY_OPTIONS.map((sz) => {
                const selected = activeDensity === sz.id;
                return (
                  <button
                    key={sz.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={sz.label}
                    title={sz.label}
                    onClick={() => {
                      if (!selected) {
                        Promise.resolve(onUpdateSettings({ widgetSize: sz.id })).catch(() => {});
                      }
                    }}
                    className={cn(
                      "relative min-w-11 min-h-11 w-11 h-11 flex items-center justify-center rounded-full outline-none transition-colors duration-200 touch-manipulation",
                      "focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-panel",
                      selected ? "text-black" : "text-neutral-500 hover:text-neutral-200"
                    )}
                  >
                    {selected && (
                      <motion.span
                        layoutId="density-pill"
                        className="absolute inset-0 rounded-full bg-white"
                        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                      />
                    )}
                    <sz.icon size={14} strokeWidth={selected ? 2.5 : 2} className="relative z-[1]" />
                  </button>
                );
              })}
            </div>
          </LayoutGroup>

          {/* IDENTITY TRIGGER */}
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setIsOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={isOpen}
              aria-label="Account menu"
              className={cn(
                "group relative flex items-center gap-2 min-h-11 h-11 pl-1 pr-2 md:pr-2.5 rounded-full outline-none transition-all duration-200 touch-manipulation",
                "bg-white/[0.03] ring-1 ring-inset ring-white/[0.08]",
                "hover:bg-white/[0.05] hover:ring-white/[0.14]",
                "focus-visible:ring-2 focus-visible:ring-accent/50",
                "active:scale-[0.97]",
                isOpen && "bg-white/[0.06] ring-white/[0.16]"
              )}
            >
              <AvatarFace user={user} />
              {shortName && (
                <span className="hidden lg:block max-w-[7rem] text-[11px] font-black text-white/90 truncate tracking-tight">
                  {shortName}
                </span>
              )}
              <ChevronDown
                size={13}
                strokeWidth={2.5}
                className={cn(
                  "text-neutral-500 transition-transform duration-200 shrink-0",
                  isOpen && "rotate-180 text-white"
                )}
              />
            </button>

            {/* IDENTITY DROPDOWN */}
            <AnimatePresence>
              {isOpen && (
                <motion.div
                  role="menu"
                  initial={{ opacity: 0, y: 8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 4, scale: 0.98 }}
                  transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                  className="absolute right-0 mt-3 w-64 rounded-2xl bg-[#0c0c0e] p-2 shadow-[0_24px_80px_rgba(0,0,0,0.85)] z-50 ring-1 ring-white/[0.08]"
                >
                  <div className="flex items-center gap-3 px-2.5 py-2.5 mb-1 rounded-xl">
                    <AvatarFace user={user} size="lg" />
                    <div className="flex flex-col min-w-0">
                      <span className="text-[12px] font-black text-white truncate tracking-tight leading-none">
                        {user?.displayName || shortName || 'Account'}
                      </span>
                      {user?.email && (
                        <span className="mt-1.5 text-[10px] font-medium text-neutral-500 truncate">
                          {user.email}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="h-px bg-white/[0.06] mx-1 mb-1" />

                  <div className="space-y-0.5">
                    <DropdownItem icon={Layout} label="Track" onClick={() => { onNavigate('track'); setIsOpen(false); }} />
                    <DropdownItem icon={BarChart3} label="History" onClick={() => { onNavigate('history'); setIsOpen(false); }} />
                    <DropdownItem icon={Settings} label="Settings" onClick={() => { onNavigate('settings'); setIsOpen(false); }} />
                    <DropdownItem icon={LogOut} label="Sign out" onClick={() => { onRequestLogout(); setIsOpen(false); }} danger />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </header>
  );
};

const DropdownItem = ({ icon: Icon, label, onClick, danger }) => (
  <button
    type="button"
    role="menuitem"
    onClick={onClick}
    className={cn(
      "w-full flex items-center gap-3 px-3 h-11 rounded-xl text-[11px] font-bold tracking-wide transition-colors duration-200",
      danger
        ? "text-rose-400 hover:bg-rose-500/10"
        : "text-neutral-300 hover:text-white hover:bg-white/[0.04]"
    )}
  >
    <Icon size={15} strokeWidth={2.25} className="opacity-80" />
    {label}
  </button>
);
