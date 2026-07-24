import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import { User, Check, Plus, ArrowUp, ArrowDown, Edit2, Trash2, Camera, Loader2, Package, Wind, Moon, Square, Columns2, LayoutGrid, AlertTriangle } from 'lucide-react';
import { updateProfile, EmailAuthProvider, GoogleAuthProvider, reauthenticateWithCredential, reauthenticateWithPopup, reauthenticateWithRedirect, deleteUser } from 'firebase/auth';
import { auth } from '../../firebase';
import { RegistryService } from '../../services/registryService';
import { Input, Button, UI, Card } from '../Common';
import { cn } from '../../utils/utils';
import { sanitizeString, compressAvatarFile } from '../../utils/security';
import { mapAuthError } from '../../utils/errorHandlers';
import { AUTH_INTENT_KEY, prefersAuthRedirect } from '../../utils/platform';
import { useKeyboardInset } from '../../hooks/useKeyboardInset';
import { ConfirmModal } from '../modals/ConfirmModal';
import { AlertOverlay } from '../modals/Modals';
import { useDialogA11y } from '../../hooks/useDialogA11y';
import { ACCENTS } from '../../constants/ui';

const hasPasswordProvider = (u) =>
  !!u?.providerData?.some((p) => p.providerId === 'password');
const hasGoogleProvider = (u) =>
  !!u?.providerData?.some((p) => p.providerId === 'google.com');

const DENSITY_OPTIONS = [
  { id: 'SMALL', label: 'Compact', icon: LayoutGrid },
  { id: 'MEDIUM', label: 'Comfortable', icon: Columns2 },
  { id: 'LARGE', label: 'Spacious', icon: Square },
];

const formatDayStart = (hour) => {
  if (hour === 0) return '12:00 AM';
  if (hour < 12) return `${hour}:00 AM`;
  if (hour === 12) return '12:00 PM';
  return `${hour - 12}:00 PM`;
};

const TYPE_LABELS = {
  CIGARETTE: 'Cigarette',
  RYO_ROLL: 'RYO',
  JOINT_KING: 'Cigarette',
  SIMPLE: 'Custom',
};

const ProtocolListItem = React.memo(({ config, idx, total, onReo, onEdit, onDel }) => {
  const typeLabel = TYPE_LABELS[config.type] || 'Tracker';
  return (
    <div className="group flex items-center gap-3 md:gap-4 w-full px-3 py-3 md:px-4 rounded-2xl bg-white/[0.02] ring-1 ring-inset ring-white/[0.06] hover:bg-white/[0.035] hover:ring-white/[0.1] transition-colors duration-200">
      <div className="flex flex-col gap-0.5 shrink-0">
        <button
          type="button"
          onClick={() => onReo(config.id, 'up')}
          disabled={idx === 0}
          aria-label="Move up"
          className="min-w-11 min-h-11 w-11 h-11 flex items-center justify-center rounded-lg text-neutral-600 hover:text-white hover:bg-white/[0.06] disabled:opacity-20 disabled:pointer-events-none transition-colors touch-manipulation"
        >
          <ArrowUp size={14} strokeWidth={2.75} />
        </button>
        <button
          type="button"
          onClick={() => onReo(config.id, 'down')}
          disabled={idx === total - 1}
          aria-label="Move down"
          className="min-w-11 min-h-11 w-11 h-11 flex items-center justify-center rounded-lg text-neutral-600 hover:text-white hover:bg-white/[0.06] disabled:opacity-20 disabled:pointer-events-none transition-colors touch-manipulation"
        >
          <ArrowDown size={14} strokeWidth={2.75} />
        </button>
      </div>

      <div className="flex flex-col gap-1.5 min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[14px] font-black text-white tracking-tight truncate">
            {config.name}
          </span>
          <span className="shrink-0 inline-flex items-center px-1.5 h-5 rounded-md text-[11px] font-black uppercase tracking-[0.12em] text-neutral-400 bg-white/[0.04] ring-1 ring-inset ring-white/[0.06]">
            {typeLabel}
          </span>
        </div>
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-400">
          Daily limit {config.limit}
        </span>
      </div>

      <div className="flex flex-col items-end gap-0.5 shrink-0 mr-1">
        <span className="text-lg font-black tabular-nums text-white leading-none">{config.limit}</span>
        <span className="text-[10px] font-black uppercase tracking-[0.14em] text-neutral-400">/ day</span>
      </div>

      <div className="flex items-center gap-0.5 shrink-0">
        <button
          type="button"
          onClick={() => onEdit(config)}
          aria-label={`Edit ${config.name}`}
          className="flex items-center justify-center min-w-11 min-h-11 w-11 h-11 rounded-lg text-neutral-500 hover:text-white hover:bg-white/[0.07] transition-all active:scale-90 touch-manipulation"
        >
          <Edit2 size={15} strokeWidth={2.5} />
        </button>
        <button
          type="button"
          onClick={() => onDel(config.id)}
          aria-label={`Delete ${config.name}`}
          className="flex items-center justify-center min-w-11 min-h-11 w-11 h-11 rounded-lg text-neutral-600 hover:text-rose-400 hover:bg-rose-500/10 transition-all active:scale-90 touch-manipulation"
        >
          <Trash2 size={15} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
});

export const SettingsScreen = ({ configs, user, settings, onAdd, onReo, onEditP, onUpd, onDel }) => {
  const keyboardInset = useKeyboardInset();
  const [displayName, setDisplayName] = useState(user?.displayName || settings.name || '');
  const [isUploading, setIsUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(settings.avatar || null);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [notification, setNotification] = useState(null);
  const [nameError, setNameError] = useState('');
  const fileInputRef = useRef(null);
  const deleteDialogRef = useDialogA11y(showDeleteAccount, () => setShowDeleteAccount(false), { disabled: isDeletingAccount });

  // UI-only economics editors; persisted fields match Android UserProfile.
  const initialMode = (settings.purchaseType === 'POUCH') ? 'POUCH' : 'PACK';
  const [ecoMode, setEcoMode] = useState(initialMode);
  const [packPrice, setPackPrice] = useState(
    settings.purchaseType === 'PACK' && settings.unitPrice
      ? Number((settings.unitPrice * 20).toFixed(2))
      : 8.00
  );
  const [packQty, setPackQty] = useState(20);
  const packQtyRef = useRef(packQty);
  packQtyRef.current = packQty;
  const [pouchPrice, setPouchPrice] = useState(settings.pouchPrice || 6.50);
  const [estimatedYield, setEstimatedYield] = useState(settings.estimatedYield || 60);
  const [pendingDayStart, setPendingDayStart] = useState(settings.dayStartHour ?? 6);

  useEffect(() => {
    setDisplayName(user?.displayName || settings.name || '');
  }, [user?.displayName, settings.name]);

  useEffect(() => {
    setPreviewUrl(settings.avatar || null);
  }, [settings.avatar]);

  useEffect(() => {
    setPendingDayStart(settings.dayStartHour ?? 6);
  }, [settings.dayStartHour]);

  useEffect(() => {
    const mode = settings.purchaseType === 'POUCH' ? 'POUCH' : 'PACK';
    setEcoMode(mode);
    if (mode === 'POUCH') {
      setPouchPrice(settings.pouchPrice || 6.50);
      setEstimatedYield(settings.estimatedYield || 60);
    } else if (settings.unitPrice != null) {
      setPackPrice(Number((settings.unitPrice * (packQtyRef.current || 20)).toFixed(2)));
    }
  }, [settings.purchaseType, settings.pouchPrice, settings.estimatedYield, settings.unitPrice]);

  const sortedConfigs = useMemo(
    () => [...configs].sort((a, b) => a.order - b.order),
    [configs]
  );

  const unitCostPreview = ecoMode === 'PACK'
    ? (packPrice / (packQty || 1))
    : (pouchPrice / (estimatedYield || 1));

  const safeUpd = useCallback(async (patch, { successTitle, successMessage } = {}) => {
    try {
      await onUpd(patch);
      if (successTitle) {
        setNotification({ title: successTitle, message: successMessage || 'Saved.', type: 'success' });
      }
      return true;
    } catch (err) {
      console.error(err);
      setNotification({ title: successTitle || 'Settings', message: 'Could not save. Try again.', type: 'error' });
      return false;
    }
  }, [onUpd]);

  const handleSaveEco = async () => {
    try {
      if (ecoMode === 'PACK') {
        const rp = Math.max(0, parseFloat(packPrice) || 0);
        const rq = Math.max(1, parseInt(packQty, 10) || 1);
        const unitPrice = rp / rq;
        await onUpd({
          purchaseType: 'PACK',
          unitPrice,
          pouchPrice: 0,
          estimatedYield: 0
        });
      } else {
        const bp = Math.max(0, parseFloat(pouchPrice) || 0);
        const by = Math.max(1, parseInt(estimatedYield, 10) || 1);
        await onUpd({
          purchaseType: 'POUCH',
          pouchPrice: bp,
          estimatedYield: by,
          unitPrice: bp / by
        });
      }
      setNotification({ title: "Economics", message: "Calibration synchronized.", type: 'success' });
    } catch (err) {
      console.error(err);
      setNotification({ title: "Economics", message: "Could not save economics.", type: 'error' });
    }
  };

  const commitDayStart = async (nextHour = pendingDayStart) => {
    const hour = Math.max(0, Math.min(23, Number(nextHour) || 0));
    if (hour === (settings.dayStartHour ?? 6)) return;
    try {
      await onUpd({ dayStartHour: hour });
      setNotification({ title: 'Day start', message: `Resets at ${formatDayStart(hour)}.`, type: 'success' });
    } catch (err) {
      console.error(err);
      setNotification({ title: 'Day start', message: 'Could not update day start.', type: 'error' });
    }
  };

  const handleApplyName = async () => {
    const name = sanitizeString(displayName);
    if (!name) {
      setNameError('Enter a display name.');
      return;
    }
    setNameError('');
    try {
      await onUpd({ name });
      if (auth.currentUser) {
        try { await updateProfile(auth.currentUser, { displayName: name }); } catch (err) { console.error(err); }
      }
    } catch (err) {
      console.error(err);
      setNotification({ title: "Profile", message: "Could not save name.", type: 'error' });
    }
  };

  const handleAvatarPick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !user) return;
    const previousPreview = previewUrl;
    setIsUploading(true);
    try {
      const dataUrl = await compressAvatarFile(file);
      setPreviewUrl(dataUrl);
      await onUpd({ avatar: dataUrl });
      // Do not write data URLs to Auth photoURL (size limits); Firestore holds the avatar.
      if (auth.currentUser?.photoURL?.startsWith('data:')) {
        try { await updateProfile(auth.currentUser, { photoURL: null }); } catch { /* ignore */ }
      }
    } catch (err) {
      console.error(err);
      setPreviewUrl(previousPreview);
      const saveFailed = err?.code === 'permission-denied' || err?.message?.includes?.('PERMISSION_DENIED');
      setNotification({
        title: "Avatar",
        message: err?.message === 'AVATAR_TOO_LARGE'
          ? "Image still too large after compression."
          : err?.message === 'DECODE_FAILED'
            ? "Could not read that photo. Try a JPEG or PNG from your library."
            : err?.message === 'INVALID_IMAGE'
              ? "Choose a photo (JPEG, PNG, or WebP)."
              : saveFailed
                ? "Could not save avatar."
                : "Could not process image.",
        type: 'error'
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteAccount = async (method = 'password') => {
    if (!user || !auth.currentUser || isDeletingAccount) return;
    if (method === 'password' && !deletePassword) return;
    setIsDeletingAccount(true);
    try {
      if (method === 'google') {
        if (prefersAuthRedirect()) {
          sessionStorage.setItem(AUTH_INTENT_KEY, 'google-delete');
          await reauthenticateWithRedirect(auth.currentUser, new GoogleAuthProvider());
          return;
        }
        await reauthenticateWithPopup(auth.currentUser, new GoogleAuthProvider());
      } else {
        const cred = EmailAuthProvider.credential(user.email, deletePassword);
        await reauthenticateWithCredential(auth.currentUser, cred);
      }
      await RegistryService.deleteAllUserData(user.uid);
      try {
        await deleteUser(auth.currentUser);
      } catch (authErr) {
        // Firestore already wiped — ask user to retry Auth deletion.
        console.error(authErr);
        setNotification({
          title: 'Delete incomplete',
          message: 'Your data was erased but login removal failed. Sign in again and retry Delete Account.',
          type: 'error'
        });
        return;
      }
      setShowDeleteAccount(false);
    } catch (err) {
      console.error(err);
      if (err?.code === 'auth/popup-closed-by-user' || err?.code === 'auth/cancelled-popup-request') {
        setNotification({ title: 'Delete cancelled', message: 'Deletion cancelled.', type: 'error' });
      } else {
        setNotification({
          title: 'Delete failed',
          message: mapAuthError(err, 'delete'),
          type: 'error'
        });
      }
    } finally {
      setIsDeletingAccount(false);
    }
  };

  const canPasswordDelete = hasPasswordProvider(auth.currentUser || user);
  const canGoogleDelete = hasGoogleProvider(auth.currentUser || user);

  return (
    <div className="pb-32">
      <h1 className="sr-only">Settings</h1>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-start max-w-7xl mx-auto">

        <div className="space-y-10">
          <Card className="p-6 md:p-8 bg-bg-card">
            <div className="flex items-end justify-between gap-4 mb-8">
              <div className="flex flex-col gap-1 min-w-0">
                <span className={cn(UI.LABEL, 'mb-0 ml-0')}>Profile</span>
                <h3 className="text-xl md:text-2xl font-black tracking-tight text-white leading-none">
                  Identity
                </h3>
              </div>
              {user?.email && (
                <span className="text-[10px] font-medium text-neutral-500 truncate max-w-[50%] text-right">
                  {user.email}
                </span>
              )}
            </div>

            <input type="file" ref={fileInputRef} onChange={handleAvatarPick} className="hidden" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/*" />

            <div className="flex flex-col sm:flex-row sm:items-center gap-6 sm:gap-8">
              <div className="relative shrink-0 self-center sm:self-start">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  aria-label="Change avatar"
                  className="group relative flex items-center justify-center w-28 h-28 md:w-32 md:h-32 rounded-full bg-white/[0.03] ring-1 ring-inset ring-white/[0.08] overflow-hidden transition-all hover:ring-accent/40 focus-visible:ring-2 focus-visible:ring-accent/50 outline-none disabled:opacity-60"
                >
                  {isUploading && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/55">
                      <Loader2 className="animate-spin text-accent" size={22} />
                    </div>
                  )}
                  {previewUrl ? (
                    <img src={previewUrl} alt="" className="object-cover w-full h-full" />
                  ) : (() => {
                    const raw = (displayName || user?.email || '').trim();
                    const parts = raw.split(/\s+/).filter(Boolean);
                    const initials = parts.length >= 2
                      ? `${parts[0][0]}${parts[1][0]}`.toUpperCase()
                      : raw.slice(0, 2).toUpperCase();
                    return initials ? (
                      <span className="text-2xl font-black tracking-tight text-accent">{initials}</span>
                    ) : (
                      <User size={36} className="text-neutral-600" strokeWidth={1.75} />
                    );
                  })()}
                  <span className="absolute inset-0 bg-black/0 group-hover:bg-black/35 group-active:bg-black/35 transition-colors" />
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  aria-label="Upload photo"
                  className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center min-w-11 min-h-11 w-11 h-11 rounded-full bg-accent text-black ring-2 ring-[#0c0c0e] shadow-lg hover:brightness-110 active:scale-95 transition-all disabled:opacity-50 touch-manipulation"
                >
                  <Camera size={15} strokeWidth={2.75} />
                </button>
              </div>

              <div className="flex-1 w-full space-y-5 min-w-0">
                <p className="text-[11px] text-neutral-500 leading-relaxed sm:pt-1">
                  Photo stays in your profile. Tap the camera to replace it
                  {previewUrl ? ', or remove it below.' : '.'}
                  {' '}On iPhone, JPEG/PNG are safest; HEIC is converted when possible.
                </p>
                <Input
                  label="Display name"
                  value={displayName}
                  onChange={(value) => { setDisplayName(value); if (nameError) setNameError(''); }}
                  isDark
                  placeholder="Your name"
                />
                {nameError && <p role="alert" className="text-[10px] font-bold text-rose-400">{nameError}</p>}
                <div className="flex flex-col sm:flex-row gap-2.5">
                  <Button className="flex-1" onClick={handleApplyName}>
                    Save name
                  </Button>
                  {previewUrl && (
                    <Button
                      variant="secondary"
                      className="sm:px-5"
                      onClick={() => setShowRemoveConfirm(true)}
                      title="Remove avatar"
                    >
                      <Trash2 size={18} className="text-rose-400" />
                      <span className="sm:hidden ml-2">Remove photo</span>
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </Card>

          <Card className="p-6 md:p-8 bg-bg-card">
            <div className="flex flex-col gap-1 mb-8 min-w-0">
              <span className={cn(UI.LABEL, 'mb-0 ml-0')}>Appearance</span>
              <h3 className="text-xl md:text-2xl font-black tracking-tight text-white leading-none">
                Look & density
              </h3>
            </div>

            <div className="space-y-8">
              <div className="space-y-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className={cn(UI.LABEL, 'mb-0 ml-0')}>Accent</span>
                  <span className="text-[10px] font-black uppercase tracking-[0.18em] text-accent tabular-nums">
                    {ACCENTS.find((a) => a.v === settings.accent)?.n || 'Custom'}
                  </span>
                </div>

                <div
                  role="radiogroup"
                  aria-label="Accent color"
                  className="grid grid-cols-3 sm:grid-cols-6 gap-2 p-2 rounded-2xl bg-white/[0.02] ring-1 ring-inset ring-white/[0.06]"
                >
                  {ACCENTS.map((x) => {
                    const selected = settings.accent === x.v;
                    return (
                      <button
                        key={x.v}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        aria-label={x.n}
                        title={x.n}
                        onClick={() => {
                          if (!selected) safeUpd({ accent: x.v });
                        }}
                        className={cn(
                          "group relative flex flex-col items-center gap-2.5 py-3 px-2 rounded-xl outline-none transition-all duration-200",
                          "focus-visible:ring-2 focus-visible:ring-accent/50",
                          selected
                            ? "bg-white/[0.06] ring-1 ring-inset ring-white/15"
                            : "hover:bg-white/[0.04]"
                        )}
                      >
                        <span
                          className={cn(
                            "relative flex items-center justify-center w-9 h-9 rounded-full transition-transform duration-200",
                            "ring-2 ring-offset-2 ring-offset-[#0c0c0e]",
                            selected ? "ring-white scale-105" : "ring-transparent group-hover:scale-105"
                          )}
                          style={{ backgroundColor: x.v }}
                        >
                          {selected && (
                            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-black/55">
                              <Check size={11} className="text-white" strokeWidth={3.5} />
                            </span>
                          )}
                        </span>
                        <span
                          className={cn(
                            "text-[10px] font-black uppercase tracking-[0.12em] leading-none",
                            selected ? "text-white" : "text-neutral-400 group-hover:text-neutral-200"
                          )}
                        >
                          {x.n}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center gap-2.5 px-0.5">
                  <span className="w-2 h-2 rounded-full bg-accent shadow-[0_0_12px_var(--accent)]" />
                  <span className="text-[10px] font-semibold text-neutral-500">
                    Applied to buttons, gauges, and highlights
                  </span>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className={cn(UI.LABEL, 'mb-0 ml-0')}>Card density</span>
                  <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-neutral-500">
                    {DENSITY_OPTIONS.find((d) => d.id === settings.widgetSize)?.label || 'Comfortable'}
                  </span>
                </div>
                <LayoutGroup id="settings-density">
                  <div
                    role="radiogroup"
                    aria-label="Card density"
                    className="flex items-center p-1 gap-1 rounded-full bg-white/[0.03] ring-1 ring-inset ring-white/[0.06]"
                  >
                    {DENSITY_OPTIONS.map((sz) => {
                      const selected = (settings.widgetSize || 'MEDIUM') === sz.id;
                      return (
                        <button
                          key={sz.id}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          aria-label={sz.label}
                          title={sz.label}
                          onClick={() => {
                            if (!selected) safeUpd({ widgetSize: sz.id });
                          }}
                          className={cn(
                            "relative flex-1 h-11 flex items-center justify-center gap-2 rounded-full outline-none transition-colors duration-200",
                            "focus-visible:ring-2 focus-visible:ring-accent/50",
                            selected ? "text-black" : "text-neutral-500 hover:text-neutral-200"
                          )}
                        >
                          {selected && (
                            <motion.span
                              layoutId="settings-density-pill"
                              className="absolute inset-0 rounded-full bg-white"
                              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                            />
                          )}
                          <sz.icon size={14} strokeWidth={selected ? 2.5 : 2} className="relative z-[1]" />
                          <span className="relative z-[1] text-[10px] font-black uppercase tracking-widest hidden sm:inline">
                            {sz.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </LayoutGroup>
              </div>
            </div>
          </Card>

          <Card className="p-6 md:p-8 bg-bg-card">
            <div className="flex items-end justify-between gap-4 mb-6">
              <div className="flex flex-col gap-1 min-w-0">
                <span className={cn(UI.LABEL, 'mb-0 ml-0 inline-flex items-center gap-1.5')}>
                  <Moon size={11} className="text-accent" strokeWidth={2.5} />
                  Schedule
                </span>
                <h3 className="text-xl md:text-2xl font-black tracking-tight text-white leading-none">
                  Day start
                </h3>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className="text-[11px] font-black uppercase tracking-[0.16em] text-neutral-400">Resets at</span>
                <span className="text-2xl md:text-3xl font-black text-accent tabular-nums leading-none">
                  {formatDayStart(pendingDayStart)}
                </span>
              </div>
            </div>

            <p className="text-[11px] text-neutral-500 leading-relaxed mb-6">
              Your tracking day rolls over at this hour — useful if nights run past midnight.
            </p>

            <div className="space-y-4">
              <input
                type="range"
                min={0}
                max={23}
                step={1}
                value={pendingDayStart}
                aria-label="Day start hour"
                onChange={(e) => setPendingDayStart(Number(e.target.value))}
                onMouseUp={(e) => commitDayStart(Number(e.currentTarget.value))}
                onTouchEnd={(e) => commitDayStart(Number(e.currentTarget.value))}
                onKeyUp={(e) => {
                  if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) {
                    commitDayStart(Number(e.currentTarget.value));
                  }
                }}
                className="w-full h-2 rounded-full appearance-none cursor-pointer accent-[var(--accent)]
                  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                  [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:shadow-[0_0_0_3px_rgba(0,0,0,0.45)]
                  [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full
                  [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-accent"
                style={{
                  background: `linear-gradient(to right, var(--accent) ${(pendingDayStart / 23) * 100}%, rgba(255,255,255,0.06) ${(pendingDayStart / 23) * 100}%)`
                }}
              />
              <div className="flex justify-between px-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-neutral-400">
                {[0, 6, 12, 18, 23].map((hour) => (
                  <span
                    key={hour}
                    className={cn(
                      pendingDayStart === hour && 'text-accent'
                    )}
                  >
                    {String(hour).padStart(2, '0')}:00
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              {[
                { hour: 0, label: 'Midnight' },
                { hour: 4, label: '4 AM' },
                { hour: 6, label: '6 AM' },
                { hour: 12, label: 'Noon' },
              ].map((preset) => {
                const selected = pendingDayStart === preset.hour;
                return (
                  <button
                    key={preset.hour}
                    type="button"
                    onClick={() => {
                      setPendingDayStart(preset.hour);
                      commitDayStart(preset.hour);
                    }}
                    className={cn(
                      "h-9 px-3.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all",
                      "ring-1 ring-inset outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
                      selected
                        ? "bg-accent text-black ring-accent"
                        : "bg-white/[0.03] text-neutral-400 ring-white/[0.06] hover:text-white hover:bg-white/[0.06]"
                    )}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </Card>
        </div>

        <div className="space-y-10">
          <Card className="flex flex-col p-6 md:p-8 bg-bg-card">
            <div className="flex items-end justify-between gap-4 mb-6">
              <div className="flex flex-col gap-1 min-w-0">
                <span className={cn(UI.LABEL, 'mb-0 ml-0')}>Trackers</span>
                <h3 className="text-xl md:text-2xl font-black tracking-tight text-white leading-none">
                  {sortedConfigs.length} {sortedConfigs.length === 1 ? 'counter' : 'counters'}
                </h3>
              </div>
              <button
                type="button"
                onClick={onAdd}
                className="inline-flex items-center gap-2 h-10 px-3.5 rounded-full bg-accent text-black text-[10px] font-black uppercase tracking-widest shadow-md hover:brightness-110 active:scale-95 transition-all"
              >
                <Plus size={15} strokeWidth={3} />
                Add
              </button>
            </div>

            <div className="space-y-2">
              {sortedConfigs.length > 0 ? sortedConfigs.map((c, idx) => (
                <ProtocolListItem
                  key={c.id}
                  config={c}
                  idx={idx}
                  total={sortedConfigs.length}
                  onReo={onReo}
                  onEdit={onEditP}
                  onDel={onDel}
                />
              )) : (
                <div className="py-12 px-4 text-center rounded-2xl ring-1 ring-inset ring-white/[0.06]">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-neutral-400">No counters yet</p>
                  <p className="mt-2 text-xs text-neutral-500">Add a tracker to start counting.</p>
                  <button
                    type="button"
                    onClick={onAdd}
                    className="mt-5 inline-flex items-center gap-2 h-10 px-4 rounded-full bg-white/[0.06] text-white text-[10px] font-black uppercase tracking-widest hover:bg-white/[0.1] transition-colors"
                  >
                    <Plus size={14} strokeWidth={3} />
                    Add counter
                  </button>
                </div>
              )}
            </div>
          </Card>

          <Card className="p-8 md:p-12 bg-bg-card">
            <h3 className={UI.LABEL}>Economic Constants</h3>
            <div className="flex p-1 bg-black/60 rounded-full border border-white/5 my-8 shadow-inner">
              <button type="button" onClick={() => setEcoMode('PACK')} className={cn("flex-1 h-11 rounded-full text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2", ecoMode === 'PACK' ? "bg-white text-black shadow-xl" : "text-neutral-500 hover:text-white")}><Package size={14} /> Retail</button>
              <button type="button" onClick={() => setEcoMode('POUCH')} className={cn("flex-1 h-11 rounded-full text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2", ecoMode === 'POUCH' ? "bg-white text-black shadow-xl" : "text-neutral-500 hover:text-white")}><Wind size={14} /> Loose</button>
            </div>
            <div className="grid grid-cols-2 gap-6">
              <Input label={ecoMode === 'PACK' ? "Pack Price (€)" : "Beutel Price (€)"} type="number" step="0.01" value={ecoMode === 'PACK' ? packPrice : pouchPrice} onChange={ecoMode === 'PACK' ? setPackPrice : setPouchPrice} isDark />
              <Input label={ecoMode === 'PACK' ? "Units / Pack" : "Est. Yield"} type="number" value={ecoMode === 'PACK' ? packQty : estimatedYield} onChange={ecoMode === 'PACK' ? setPackQty : setEstimatedYield} isDark />
            </div>
            <div className="mt-10 pt-10 border-t border-white/5 space-y-8">
              <div className="flex items-center justify-between px-2">
                <span className={UI.LABEL}>Unit Cost:</span>
                <span className="text-3xl font-black text-white tabular-nums">€{unitCostPreview.toFixed(2)}</span>
              </div>
              <Button className="w-full" onClick={handleSaveEco}>Synchronize Economics</Button>
            </div>
          </Card>

          <Card danger className="p-6 md:p-8">
            <div className="flex items-start gap-3 mb-5">
              <div className="flex items-center justify-center w-9 h-9 shrink-0 rounded-xl bg-rose-500/10 ring-1 ring-inset ring-rose-500/25 text-rose-400">
                <AlertTriangle size={16} strokeWidth={2.5} />
              </div>
              <div className="flex flex-col gap-1 min-w-0">
                <span className={cn(UI.LABEL, 'mb-0 ml-0 text-rose-400/80')}>Danger zone</span>
                <h3 className="text-xl font-black tracking-tight text-white leading-none">
                  Delete account
                </h3>
              </div>
            </div>

            <p className="text-[12px] text-neutral-400 leading-relaxed mb-4">
              This permanently removes your data and sign-in. It cannot be undone.
            </p>
            <a
              href="/privacy.html"
              target="_blank"
              rel="noreferrer"
              className="inline-flex mb-4 text-[11px] font-bold text-neutral-400 underline underline-offset-4 hover:text-white"
            >
              Privacy and data handling
            </a>
            <ul className="mb-6 space-y-1.5 text-[11px] text-neutral-500">
              {['Trackers and daily limits', 'History and session logs', 'Profile settings and login'].map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <span className="w-1 h-1 rounded-full bg-rose-400/70 shrink-0" />
                  {item}
                </li>
              ))}
            </ul>

            <Button
              variant="danger"
              className="w-full"
              onClick={() => { setDeletePassword(''); setShowDeleteAccount(true); }}
            >
              Delete account
            </Button>
          </Card>
        </div>
      </div>

      <ConfirmModal isOpen={showRemoveConfirm} onClose={() => setShowRemoveConfirm(false)} onConfirm={async () => {
        try {
          await onUpd({ avatar: null });
          if (auth.currentUser?.photoURL) {
            try { await updateProfile(auth.currentUser, { photoURL: null }); } catch { /* ignore */ }
          }
          setPreviewUrl(null); setShowRemoveConfirm(false);
        } catch (err) {
          console.error(err);
          setNotification({ title: "Avatar", message: "Could not remove avatar.", type: 'error' });
        }
      }} title="Delete photo?" message="Your profile photo will be permanently deleted." confirmText="Delete" />

      <AnimatePresence>
        {showDeleteAccount && (
          <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center p-0 sm:p-8 isolate">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !isDeletingAccount && setShowDeleteAccount(false)}
              className="absolute inset-0 bg-black/90 backdrop-blur-2xl"
            />
            <motion.div
              ref={deleteDialogRef}
              tabIndex={-1}
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-account-title"
              aria-describedby="delete-account-description"
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              className="custom-scrollbar relative w-full max-w-[400px] z-[10000] max-h-[min(92dvh,92vh)] overflow-y-auto sm:pb-0"
              style={{ paddingBottom: `max(1.5rem, env(safe-area-inset-bottom), ${Math.max(keyboardInset, 16)}px)` }}
            >
              <Card className="p-10 border-danger/30 bg-red-950/20 space-y-6">
                <h3 id="delete-account-title" className="text-2xl font-black uppercase tracking-tight text-white text-center">Delete Account?</h3>
                <p id="delete-account-description" className="text-xs font-bold uppercase tracking-[0.16em] text-neutral-400 text-center leading-relaxed">
                  {!canPasswordDelete && !canGoogleDelete
                    ? 'This account has no password or Google sign-in linked. Use a supported method, then retry deletion.'
                    : canPasswordDelete && canGoogleDelete
                      ? 'Confirm with password or Google to permanently wipe Firestore data and Auth.'
                      : canGoogleDelete
                        ? 'Confirm with Google to permanently wipe Firestore data and Auth.'
                        : 'Enter your password to permanently wipe Firestore data and Auth.'}
                </p>
                {canPasswordDelete && (
                  <Input
                    label="Password"
                    type="password"
                    value={deletePassword}
                    onChange={setDeletePassword}
                    isDark
                    placeholder="••••••••"
                    autoComplete="current-password"
                    name="delete-password"
                    enterKeyHint="go"
                  />
                )}
                <div className="flex flex-col gap-3">
                  {!canPasswordDelete && !canGoogleDelete ? (
                    <Button variant="secondary" onClick={() => setShowDeleteAccount(false)}>Close</Button>
                  ) : (
                    <>
                  {canPasswordDelete && (
                    <Button
                      variant="danger"
                      disabled={isDeletingAccount || !deletePassword}
                      onClick={() => handleDeleteAccount('password')}
                    >
                      {isDeletingAccount ? 'Deleting…' : 'Delete Forever'}
                    </Button>
                  )}
                  {canGoogleDelete && (
                    <Button
                      variant="danger"
                      disabled={isDeletingAccount}
                      onClick={() => handleDeleteAccount('google')}
                    >
                      {isDeletingAccount
                        ? 'Deleting…'
                        : canPasswordDelete
                          ? 'Confirm with Google'
                          : 'Delete with Google'}
                    </Button>
                  )}
                  <Button variant="secondary" disabled={isDeletingAccount} onClick={() => setShowDeleteAccount(false)}>
                    Cancel
                  </Button>
                    </>
                  )}
                </div>
              </Card>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AlertOverlay isOpen={!!notification} onClose={() => setNotification(null)} title={notification?.title} message={notification?.message} type={notification?.type || 'error'} />
    </div>
  );
};
