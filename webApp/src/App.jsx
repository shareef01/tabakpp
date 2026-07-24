import React, { useState, useEffect, useCallback, useRef, Suspense, lazy } from 'react';
import { motion, AnimatePresence, MotionConfig } from 'framer-motion';
import { AlertCircle, Loader2, Plus } from 'lucide-react';
import { RegistryService } from './services/registryService';
import { auth } from './firebase';

// --- CONSTANTS & UTILS ---
import { hexToRgbValues } from './utils/formatters';
import { SmokingCalculator } from './utils/smokingCalculator';
const cn = (...classes) => classes.filter(Boolean).join(' ');

// --- CONTEXT & HOOKS ---
import { AuthProvider, useAuth } from './context/AuthContext';
import { useRegistry } from './hooks/useRegistry';

// --- SHARED COMPONENTS ---
import { TopBanner } from './components/layout/TopBanner';
import { BottomNav } from './components/layout/BottomNav';
import { LogoutModal } from './components/modals/Modals';
import { ConfirmModal } from './components/modals/ConfirmModal';
import { DashboardSkeleton } from './components/dashboard/DashboardSkeleton';
import { ProtocolFormOverlay } from './components/modals/ProtocolFormOverlay';
import { EditOverlay } from './components/modals/EditOverlay';
import { ManualEntryOverlay } from './components/modals/ManualEntryOverlay';
import { UndoToast, UNDO_TOAST_MS } from './components/feedback/UndoToast';

// --- LAZY LOADED SCREENS ---
const lazyWithRetry = (componentImport) => lazy(async () => {
  try {
    return await componentImport();
  } catch (error) {
    console.error("[ARCH] Dynamic import failure, forcing refresh...", error);
    window.location.reload();
    return { default: () => null };
  }
});

const AuthScreen = lazyWithRetry(() => import('./components/auth/AuthScreen').then(m => ({ default: m.AuthScreen })));
const TrackerCard = lazyWithRetry(() => import('./components/dashboard/TrackerCard').then(m => ({ default: m.TrackerCard })));
const MetricBanner = lazyWithRetry(() => import('./components/dashboard/MetricBanner').then(m => ({ default: m.MetricBanner })));
const HistoryScreen = lazyWithRetry(() => import('./components/history/HistoryScreen').then(m => ({ default: m.HistoryScreen })));
const SettingsScreen = lazyWithRetry(() => import('./components/settings/SettingsScreen').then(m => ({ default: m.SettingsScreen })));

// --- CORE SYSTEM COMPONENTS ---

const LoadingView = React.memo(() => (
  <div role="status" aria-live="polite" className="flex flex-col items-center justify-center min-h-screen min-h-dvh w-full space-y-12 bg-black text-white font-inter antialiased">
    <Loader2 className="animate-spin text-accent" size={64} strokeWidth={3} aria-hidden />
    <span className="text-[11px] font-black uppercase tracking-[0.35em] text-white/55 animate-pulse">Synchronizing</span>
    <span className="sr-only">Loading registry</span>
  </div>
));

const OfflineBanner = ({ isOffline }) => (
  <AnimatePresence>
    {isOffline && (
      <motion.div
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: 'auto', opacity: 1 }}
        exit={{ height: 0, opacity: 0 }}
        className="w-full bg-amber-500/10 border-b border-amber-500/20 overflow-hidden"
      >
        <div className="flex items-center justify-center py-2 gap-3 text-amber-500">
          <AlertCircle size={14} strokeWidth={3} />
          <span className="text-[12px] font-black uppercase tracking-[0.2em]">You're offline — changes may fail until you're back online</span>
        </div>
      </motion.div>
    )}
  </AnimatePresence>
);

class GlobalErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, info) {
    console.error('[SYS] Uncaught render error', error, info?.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen min-h-dvh w-full p-12 text-center bg-black text-white font-inter antialiased">
          <div className="p-8 mb-8 bg-red-600/10 rounded-[32px] text-red-500 border border-red-600/20 shadow-2xl"><AlertCircle size={48} /></div>
          <h2 className="mb-4 text-3xl font-black uppercase tracking-tighter leading-none">System Fault</h2>
          <p className="max-w-md mb-10 text-sm font-bold leading-relaxed text-white/60">{this.state.error?.toString() || "Registry sync error."}</p>
          <button onClick={async () => { try { await auth.signOut(); } catch { /* ignore */ } localStorage.clear(); window.location.reload(); }} className="px-10 transition-all shadow-2xl h-18 rounded-full bg-white text-black font-black uppercase tracking-widest active:scale-95">Reset Engine</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- APP ARCHITECTURE ---

const AppContent = () => {
  const { user, loading: isAuthLoading, deleteError, clearDeleteError } = useAuth();

  // 1. BUILD ID — force a one-shot reload when a new deploy is detected.
  // Service worker autoUpdate (virtual:pwa-register) handles subsequent SW swaps.
  useEffect(() => {
    const localBuildId = localStorage.getItem('tabak_build_id');
    const serverBuildId = String(typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : 'initial');

    if (localBuildId && localBuildId !== serverBuildId && localBuildId !== 'initial') {
      localStorage.setItem('tabak_build_id', serverBuildId);
      window.location.reload();
    } else {
      localStorage.setItem('tabak_build_id', serverBuildId);
    }
  }, []);

  // 2. STATE MANAGEMENT
  const [settings, setSettings] = useState(() => {
    let accent = '#10B981';
    try {
      const fromQuery = new URLSearchParams(window.location.search).get('accent');
      if (fromQuery && /^#[0-9A-Fa-f]{6}$/.test(fromQuery)) accent = fromQuery;
    } catch { /* ignore */ }
    return {
      accent,
      widgetSize: 'MEDIUM',
      avatar: null,
      name: '',
      unitPrice: 0.5,
      dayStartHour: 6,
      purchaseType: 'PACK',
      pouchPrice: 0,
      estimatedYield: 0
    };
  });
  const [isHydrated, setIsHydrated] = useState(false);
  const [activeTab, setActiveTab] = useState('track');
  const scrollPositions = useRef({ track: 0 });
  const activeTabRef = useRef(activeTab);
  const [incrementUndo, setIncrementUndo] = useState(null);

  // Modal States
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [editProtocol, setEditProtocol] = useState(null);
  const [isLogoutOpen, setIsLogoutOpen] = useState(false);
  const [isManualEntryOpen, setIsManualEntryOpen] = useState(false);
  const [showEndDayConfirm, setShowEndDayConfirm] = useState(false);
  const [protocolToDelete, setProtocolToDelete] = useState(null);

  // Tracking day in LOCAL time with the user's day-start hour (Android
  // parity) — recomputed live so a tab left open rolls over correctly.
  const [today, setToday] = useState(() => SmokingCalculator.getTrackingDate());
  useEffect(() => {
    const tick = () => setToday(SmokingCalculator.getTrackingDate(new Date(), settings.dayStartHour));
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, [settings.dayStartHour]);

  const registry = useRegistry(user, today, settings.unitPrice);

  const {
    configs, logs, metrics, loading: isRegistryLoading, isEndingDay, isOnline, profileSettings,
    registryError, clearRegistryError,
    increment, decrement, endDay, reorder, addProtocol, updateProtocol, deleteProtocol,
    createManualEntry, deleteLog, restoreLog, updateHistoricalLog
  } = registry || { configs: [], logs: [], metrics: {}, loading: true, isOnline: true, profileSettings: null };

  // Bootstrap profile once per session (create-if-missing + smokingUnits migration).
  // Settings hydration comes from useRegistry's single profile listener.
  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    (async () => {
      try {
        await RegistryService.ensureUserDocument(user.uid, {
          name: user.displayName || '',
          accent: '#FF5F5F'
        });
        if (!cancelled) await RegistryService.migrateSmokingUnitsIfNeeded(user.uid);
      } catch (e) {
        console.error('[SYS] Profile bootstrap failed', e);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => {
    if (!profileSettings) return;
    setSettings(prev => ({
      ...prev,
      name: profileSettings.name ?? prev.name,
      accent: profileSettings.accent || prev.accent,
      widgetSize: profileSettings.widgetSize || prev.widgetSize,
      avatar: profileSettings.avatar || null,
      unitPrice: profileSettings.unitPrice ?? 0.5,
      dayStartHour: profileSettings.dayStartHour ?? 6,
      purchaseType: profileSettings.purchaseType || 'PACK',
      pouchPrice: profileSettings.pouchPrice ?? 0,
      estimatedYield: profileSettings.estimatedYield ?? 0
    }));
    setIsHydrated(true);
  }, [profileSettings]);

  // 4. ACTION HANDLERS — allowlisted settings only (Android updateProfileSettings parity)
  const [settingsError, setSettingsError] = useState(null);
  const handleUpdateSettings = useCallback(async (upd) => {
    if (!user) return;
    try {
      await RegistryService.updateProfileSettings(user.uid, upd);
      setSettingsError(null);
    } catch (e) {
      console.error("[SYS] Update failed", e);
      setSettingsError('Could not save settings. Try again.');
      throw e;
    }
  }, [user]);

  const handleAddProtocol = async (data) => {
    try { await addProtocol(data); setIsAddOpen(false); } catch (e) { console.error(e); throw e; }
  };

  const handleUpdateProtocol = async (data) => {
    try { await updateProtocol(editProtocol.id, data); setEditProtocol(null); } catch (e) { console.error(e); throw e; }
  };

  const handleIncrement = useCallback((id) => {
    increment(id).then(() => {
      const config = configs.find((item) => item.id === id);
      setIncrementUndo({ id, name: config?.name || 'Counter', key: `${id}-${Date.now()}` });
    }).catch((e) => console.error('[SYS] Increment failed', e));
  }, [increment, configs]);

  const handleDecrement = useCallback((id) => {
    decrement(id).catch(() => {});
  }, [decrement]);

  const handleTabChange = useCallback((nextTab) => {
    const current = activeTabRef.current;
    if (nextTab === current) return;
    scrollPositions.current[current] = window.scrollY;
    activeTabRef.current = nextTab;
    setActiveTab(nextTab);
    window.requestAnimationFrame(() => window.scrollTo({ top: scrollPositions.current[nextTab] ?? 0, behavior: 'auto' }));
  }, []);

  if (isAuthLoading) return <LoadingView />;

  /**
   * VIEWPORT-AWARE GRID LOGIC
   */
  const getAdaptiveGrid = (count) => {
    if (count === 1) return "grid-cols-1 max-w-2xl mx-auto";
    if (count === 2) return "grid-cols-1 sm:grid-cols-2";
    if (count === 3) return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";
    return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4";
  };

  const gridClasses = cn('grid gap-3 md:gap-4 w-full', getAdaptiveGrid(configs.length));

  return (
    <div className="flex flex-col min-h-screen min-h-dvh w-full bg-[#000000] text-white font-inter antialiased selection:bg-accent/30 overflow-x-clip relative" style={{ '--accent': settings.accent, '--accent-rgb': hexToRgbValues(settings.accent) }}>

      {/* DEFINITIVE ATMOSPHERE LAYER */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute inset-0 bg-[url('/noise.svg')] opacity-[0.05] mix-blend-overlay" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:40px_40px] [mask-image:radial-gradient(ellipse:60%_50%_at_50%_0%,#000_70%,transparent_100%)]" />
      </div>

      {!user ? (
        <Suspense fallback={<LoadingView />}>
          <AuthScreen accent={settings.accent} />
        </Suspense>
      ) : (
        <>
          <div className="sticky top-0 z-[300] w-full bg-bg-panel pt-[env(safe-area-inset-top)]">
            <OfflineBanner isOffline={!isOnline} />
            {(registryError || settingsError || deleteError) && (
              <div className="w-full bg-red-500/10 border-b border-red-500/20">
                <div className="flex items-center justify-center gap-3 py-2 px-4 text-red-400">
                  <AlertCircle size={14} strokeWidth={3} />
                  <span role="alert" className="text-xs font-black uppercase tracking-[0.14em]">{registryError || settingsError || deleteError?.message || deleteError?.title || deleteError}</span>
                  <button type="button" aria-label="Dismiss error" onClick={() => { clearRegistryError(); setSettingsError(null); clearDeleteError(); }} className="min-h-11 px-2 text-xs font-black uppercase tracking-widest underline">
                    Dismiss
                  </button>
                </div>
              </div>
            )}
            <TopBanner
              user={{...user, photoURL: settings.avatar || user.photoURL}}
              onNavigate={handleTabChange}
              widgetSize={settings.widgetSize}
              onUpdateSettings={handleUpdateSettings}
              onRequestLogout={() => setIsLogoutOpen(true)}
            />
          </div>

          <main className="flex-1 w-full pt-4 md:pt-6 pb-[calc(9rem+env(safe-area-inset-bottom))] transition-all duration-500 ease-out relative z-10">
            <div className="max-w-5xl mx-auto w-full px-4 md:px-6 lg:px-8">
              <Suspense fallback={
                <div className="flex items-center justify-center py-24">
                  <Loader2 className="animate-spin text-accent" size={32} strokeWidth={2.5} />
                </div>
              }>
                <AnimatePresence mode="wait">
                  {activeTab === 'track' && (
                    <motion.div key="track" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-4 md:space-y-5">
                      <h1 className="sr-only">Track</h1>
                      {!isHydrated || isRegistryLoading ? (
                        <DashboardSkeleton widgetSize={settings.widgetSize} />
                      ) : (
                        <>
                          {configs.length ? <div className={cn('transition-all duration-500 ease-out', gridClasses)}>
                            {[...configs].sort((a,b)=>a.order-b.order).map((c, i) => (
                              <TrackerCard
                                key={c.id}
                                config={c}
                                count={metrics.activeCounts?.[c.id] || 0}
                                onInc={handleIncrement}
                                onDec={handleDecrement}
                                index={i}
                                globalSize={settings.widgetSize}
                              />
                            ))}
                          </div> : (
                            <div className="min-h-[22rem] rounded-[2rem] border border-dashed border-white/10 bg-bg-card/70 flex flex-col items-center justify-center text-center px-8">
                              <div className="w-16 h-16 rounded-2xl bg-accent/10 text-accent flex items-center justify-center ring-1 ring-accent/20"><Plus size={28} /></div>
                              <h2 className="mt-6 text-2xl font-black tracking-tight">Start tracking</h2>
                              <p className="mt-2 max-w-sm text-sm text-neutral-500">Add a counter for cigarettes, rolls, or any habit you want to measure.</p>
                              <button type="button" onClick={() => setIsAddOpen(true)} className="mt-6 min-h-12 px-6 rounded-xl bg-accent text-black text-[11px] font-black uppercase tracking-widest">Add counter</button>
                            </div>
                          )}

                          <MetricBanner
                            m={metrics}
                            onEndDay={() => setShowEndDayConfirm(true)}
                            isEnding={isEndingDay}
                          />
                        </>
                      )}
                    </motion.div>
                  )}
                  {activeTab === 'history' && (
                    <motion.div key="history" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
                      <h1 className="sr-only">History</h1>
                      {!isHydrated || isRegistryLoading ? <DashboardSkeleton widgetSize={settings.widgetSize} /> : <HistoryScreen
                        logs={logs}
                        m={metrics}
                        onEdit={setEditTarget}
                        onAddEntry={() => setIsManualEntryOpen(true)}
                        userId={user.uid}
                        today={today}
                        unitPrice={settings.unitPrice}
                        onDeleteLog={deleteLog}
                        onRestoreLog={restoreLog}
                        historyIsTruncated={logs.length >= 1200}
                      />}
                    </motion.div>
                  )}
                  {activeTab === 'settings' && (
                    <motion.div key="settings" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
                      {!isHydrated || isRegistryLoading ? <DashboardSkeleton widgetSize={settings.widgetSize} /> : <SettingsScreen
                        configs={configs}
                        user={user}
                        settings={settings}
                        onAdd={() => setIsAddOpen(true)}
                        onReo={reorder}
                        onEditP={setEditProtocol}
                        onUpd={handleUpdateSettings}
                        onDel={(id) => setProtocolToDelete(id)}
                      />}
                    </motion.div>
                  )}
                </AnimatePresence>
              </Suspense>
            </div>
          </main>

          <BottomNav activeTab={activeTab} onTabChange={handleTabChange} />

          <AnimatePresence>
            {isLogoutOpen && (
              <LogoutModal
                isOpen={isLogoutOpen}
                onClose={() => setIsLogoutOpen(false)}
                onConfirm={() => { setIsLogoutOpen(false); auth.signOut(); }}
              />
            )}
            {isAddOpen && (
              <ProtocolFormOverlay
                isOpen={isAddOpen}
                onClose={() => setIsAddOpen(false)}
                onApply={handleAddProtocol}
                title="Create Counter"
              />
            )}
            {editProtocol && (
              <ProtocolFormOverlay
                isOpen={!!editProtocol}
                onClose={() => setEditProtocol(null)}
                onApply={handleUpdateProtocol}
                title="Configure Counter"
                initialData={editProtocol}
              />
            )}
            {editTarget && (
              <EditOverlay
                log={editTarget}
                configs={configs}
                onClose={() => setEditTarget(null)}
                onSave={updateHistoricalLog}
              />
            )}
            {isManualEntryOpen && (
              <ManualEntryOverlay
                configs={configs}
                initialDate={today}
                onClose={() => setIsManualEntryOpen(false)}
                onSave={createManualEntry}
              />
            )}
            <ConfirmModal
              isOpen={showEndDayConfirm}
              onClose={() => setShowEndDayConfirm(false)}
              onConfirm={async () => {
                setShowEndDayConfirm(false);
                try {
                  await endDay();
                } catch { /* registryError set in hook */ }
              }}
              title="End tracking day?"
              message="Today’s counts will be archived and counters reset. Archived entries can be edited in History."
              confirmText="End Day"
            />
            <ConfirmModal
              isOpen={!!protocolToDelete}
              onClose={() => setProtocolToDelete(null)}
              onConfirm={async () => {
                const id = protocolToDelete;
                setProtocolToDelete(null);
                if (id) {
                  try { await deleteProtocol(id); } catch (e) { console.error(e); }
                }
              }}
              title="Delete tracker?"
              message="This counter will be removed from your dashboard. Logged history stays available."
              confirmText="Delete"
            />
          </AnimatePresence>
          <UndoToast
            open={!!incrementUndo}
            toastKey={incrementUndo?.key}
            message={`${incrementUndo?.name || 'Counter'} increased`}
            detail="Undo available for 5 seconds"
            duration={UNDO_TOAST_MS}
            onUndo={async () => {
              const item = incrementUndo;
              setIncrementUndo(null);
              if (item) await decrement(item.id);
            }}
            onDismiss={() => setIncrementUndo(null)}
          />
        </>
      )}
    </div>
  );
};

const App = () => (
  <GlobalErrorBoundary>
    <AuthProvider>
      <MotionConfig reducedMotion="user">
        <AppContent />
      </MotionConfig>
    </AuthProvider>
  </GlobalErrorBoundary>
);

export default App;
