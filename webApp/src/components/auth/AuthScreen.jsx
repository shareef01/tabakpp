import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
} from 'firebase/auth';
import { auth } from '../../firebase';
import { Input, UI, Logo } from '../Common';
import { cn } from '../../utils/utils';
import { CigaretteGauge } from '../gauges/Gauges';
import { mapAuthError } from '../../utils/errorHandlers';
import { RegistryService } from '../../services/registryService';
import { AUTH_INTENT_KEY, prefersAuthRedirect } from '../../utils/platform';
import { sanitizeString } from '../../utils/security';
import { useKeyboardInset } from '../../hooks/useKeyboardInset';

const MIN_PASSWORD_LENGTH = 12;

/**
 * BrandedAtmosphere - High Fidelity Industrial Visuals
 */
const BrandedAtmosphere = React.memo(({ accent }) => (
  <div className="relative flex flex-col items-center justify-center w-full group">
    {/* Atmospheric Glow */}
    <div
      className="absolute inset-0 blur-[120px] rounded-full scale-150 opacity-20 transition-all duration-1000 group-hover:opacity-30"
      style={{ backgroundColor: accent }}
    />

    <div className="relative z-10 w-full max-w-[440px] px-8">
      <CigaretteGauge
        count={7}
        limit={20}
        type="CIGARETTE"
        isLarge
        isLimitReached={false}
      />
    </div>

    <div className="text-center pt-12 relative z-10">
      <motion.h2
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2, duration: 0.8 }}
        className="text-5xl md:text-7xl font-black tracking-tighter uppercase leading-tight"
      >
        EVERY SECOND <span style={{ color: accent }}>COUNTS.</span>
      </motion.h2>
      <p className="mt-8 text-xs md:text-sm font-black uppercase tracking-[0.18em] text-white/55 antialiased">
        Reclaim behavioral control
      </p>
    </div>
  </div>
));

export const AuthScreen = React.memo(({ accent = '#10B981' }) => {
  const [mode, setMode] = useState('LOGIN');
  const [e, setE] = useState('');
  const [p, setP] = useState('');
  const [n, setN] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState({ t: '', c: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const keyboardInset = useKeyboardInset();

  useEffect(() => {
    const online = () => setIsOnline(true);
    const offline = () => setIsOnline(false);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, []);

  const handle = async () => {
    if (!isOnline) {
      setMsg({ t: 'FAULT', c: 'You’re offline. Reconnect to continue.' });
      return;
    }
    setLoading(true); setMsg({ t: '', c: '' });
    try {
      if (mode === 'REGISTER' && p.length < MIN_PASSWORD_LENGTH) {
        setMsg({ t: 'FAULT', c: mapAuthError({ code: 'auth/weak-password' }, 'register') });
        return;
      }
      if (mode === 'LOGIN') {
        await signInWithEmailAndPassword(auth, e.trim(), p);
      } else if (mode === 'REGISTER') {
        const displayName = sanitizeString(n);
        const c = await createUserWithEmailAndPassword(auth, e.trim(), p);
        await updateProfile(c.user, { displayName });
        await RegistryService.ensureUserDocument(c.user.uid, {
          name: displayName,
          accent: accent || '#FF5F5F',
        });
      } else {
        await sendPasswordResetEmail(auth, e.trim());
        setMsg({ t: 'SUCCESS', c: mapAuthError(null, 'reset') });
      }
    } catch (err) {
      const ctx = mode === 'REGISTER' ? 'register' : mode === 'RESET' ? 'reset' : 'login';
      // Password reset always shows the same success-style acknowledgment (anti-enumeration).
      if (mode === 'RESET') {
        setMsg({ t: 'SUCCESS', c: mapAuthError(null, 'reset') });
      } else {
        setMsg({ t: 'FAULT', c: mapAuthError(err, ctx) });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    if (!isOnline) {
      setMsg({ t: 'FAULT', c: 'You’re offline. Reconnect to continue.' });
      return;
    }
    setLoading(true); setMsg({ t: '', c: '' });
    try {
      const provider = new GoogleAuthProvider();
      if (prefersAuthRedirect()) {
        sessionStorage.setItem(AUTH_INTENT_KEY, 'google-login');
        await signInWithRedirect(auth, provider);
        return; // navigation away — AuthContext completes via getRedirectResult
      }
      const result = await signInWithPopup(auth, provider);
      await RegistryService.ensureUserDocument(result.user.uid, {
        name: result.user.displayName || '',
      });
    } catch (err) {
      if (err?.code === 'auth/popup-closed-by-user' || err?.code === 'auth/cancelled-popup-request') {
        setMsg({ t: '', c: '' });
      } else {
        setMsg({ t: 'FAULT', c: mapAuthError(err, 'login') });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="flex flex-col items-stretch min-h-screen min-h-dvh relative overflow-x-clip bg-black text-white font-inter antialiased lg:flex-row"
      style={{'--accent': accent}}
    >
      <h1 className="sr-only">{mode === 'LOGIN' ? 'Sign in' : mode === 'REGISTER' ? 'Create account' : 'Reset password'}</h1>

      {/* STEALTH BRANDING LAYER */}
      <div className="absolute top-[max(2rem,env(safe-area-inset-top))] left-[max(2rem,env(safe-area-inset-left))] md:top-12 md:left-12 lg:top-16 lg:left-16 z-[100] pointer-events-none opacity-80">
         <Logo size="md" />
      </div>

      {/* LEFT COLUMN: Physical Component Visuals */}
      <div className="hidden lg:flex flex-1 flex-col items-center justify-center bg-black relative border-r border-white/5 overflow-hidden">
         <div className="absolute inset-0 bg-[url('/noise.svg')] opacity-10 pointer-events-none mix-blend-overlay" />
         <BrandedAtmosphere accent={accent} />
      </div>

      {/* RIGHT COLUMN: Command Input Center */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 pt-[max(5rem,calc(env(safe-area-inset-top)+4rem))] relative z-10 bg-black lg:p-24" style={{ paddingBottom: `max(1.5rem, env(safe-area-inset-bottom), ${keyboardInset + 16}px)` }}>
        <div className="w-full max-w-[480px]">

          {/* Mobile Hero (Logo) */}
          <div className="lg:hidden flex flex-col items-center mb-16 opacity-80">
            <Logo size="lg" />
            <span className="mt-4 text-[11px] font-black uppercase tracking-[0.18em] text-white/55">Executive Terminal</span>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.23, 1, 0.32, 1] }}
            className={cn(UI.CARD, "p-10 md:p-14 w-full text-center relative overflow-hidden bg-bg-card shadow-[0_50px_100px_rgba(0,0,0,0.9)]")}
          >
             {/* MODE TOGGLE (PWA High-Contrast) */}
             {mode !== 'RESET' ? <div role="tablist" aria-label="Authentication mode" className="relative flex items-center h-14 w-full mb-12 p-1 rounded-full bg-black/60 border border-white/5 shadow-inner">
                <button type="button" role="tab" aria-selected={mode === 'LOGIN'} onClick={() => setMode('LOGIN')} className={cn("relative flex-1 h-full z-20 text-xs font-black uppercase tracking-widest transition-all duration-500", mode === 'LOGIN' ? "text-black" : "text-white/55 hover:text-white/80")}>Sign in</button>
                <button type="button" role="tab" aria-selected={mode === 'REGISTER'} onClick={() => setMode('REGISTER')} className={cn("relative flex-1 h-full z-20 text-xs font-black uppercase tracking-widest transition-all duration-500", mode === 'REGISTER' ? "text-black" : "text-white/55 hover:text-white/80")}>Create account</button>
                <motion.div
                   className="absolute left-1 h-[calc(100%-8px)] bg-accent rounded-full shadow-lg"
                   animate={{ x: mode === 'LOGIN' ? 0 : '100%', left: mode === 'LOGIN' ? '4px' : '-4px' }}
                   style={{ width: 'calc(50% - 4px)' }}
                   transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
             </div> : (
               <div className="mb-12 text-left">
                 <p className="text-2xl font-black tracking-tight text-white">Reset password</p>
                 <p className="mt-2 text-[11px] text-neutral-500">Enter your email and we’ll send a reset link.</p>
               </div>
             )}

             <form
               className="flex flex-col gap-10 relative z-10 text-center"
               onSubmit={(ev) => {
                 ev.preventDefault();
                 if (!loading) handle();
               }}
             >
               {msg.c && (
                 <motion.div
                   role={msg.t === 'FAULT' ? 'alert' : 'status'}
                   aria-live={msg.t === 'FAULT' ? 'assertive' : 'polite'}
                   initial={{ scale: 0.9, opacity: 0 }}
                   animate={{ scale: 1, opacity: 1 }}
                   className={cn("p-5 rounded-xl text-center font-black text-[11px] uppercase tracking-widest border shadow-2xl", msg.t === 'FAULT' ? "bg-danger/10 text-danger border-danger/20" : "bg-accent/10 text-accent border-accent/20")}
                 >
                   {msg.c}
                 </motion.div>
               )}

               <div className="flex flex-col gap-6 text-left">
                 {mode === 'REGISTER' && (
                   <Input
                     label="Name"
                     value={n}
                     onChange={setN}
                     isDark
                     placeholder="Full Name..."
                     autoComplete="name"
                     name="name"
                     enterKeyHint="next"
                   />
                 )}
                 <Input
                   label="Email"
                   type="email"
                   value={e}
                   onChange={setE}
                   isDark
                   placeholder="Email Address..."
                   autoComplete="email"
                   name="email"
                   inputMode="email"
                   enterKeyHint={mode === 'RESET' ? 'send' : 'next'}
                 />
                 {mode !== 'RESET' && (
                   <div>
                     <div className="relative">
                       <Input
                         label="Password"
                         type={showPassword ? 'text' : 'password'}
                         value={p}
                         onChange={setP}
                         isDark
                         placeholder="••••••••••••"
                         autoComplete={mode === 'REGISTER' ? 'new-password' : 'current-password'}
                         name="password"
                         enterKeyHint="go"
                         className="[&_input]:pr-14"
                         aria-describedby={mode === 'REGISTER' ? 'password-hint' : undefined}
                       />
                       <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'} className="absolute right-2 bottom-1.5 min-w-11 min-h-11 flex items-center justify-center text-neutral-500 hover:text-white">
                         {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                       </button>
                     </div>
                     {mode === 'REGISTER' && <p id="password-hint" className="mt-2 text-[11px] text-neutral-400">Use at least 12 characters.</p>}
                   </div>
                 )}
               </div>

              <button
                type="submit"
                aria-busy={loading}
                className="group relative flex items-center justify-center w-full h-16 md:h-20 mt-4 rounded-xl bg-accent text-black font-black uppercase tracking-[0.4em] text-[11px] shadow-2xl active:scale-[0.96] transition-all duration-500 overflow-hidden"
                disabled={loading || !isOnline}
              >
                 <div className="absolute inset-0 bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                 <span className="relative z-10 flex items-center gap-3">
                   {loading ? <Loader2 className="animate-spin" size={24} strokeWidth={4} /> : (mode === 'LOGIN' ? 'SIGN IN' : (mode === 'REGISTER' ? 'CREATE ACCOUNT' : 'SEND RESET LINK'))}
                 </span>
               </button>

               {mode !== 'RESET' && (
                 <>
                   <div className="flex items-center gap-4 my-1">
                     <div className="flex-1 h-px bg-white/10" />
                     <span className="text-[11px] font-black uppercase tracking-[0.18em] text-neutral-400">Or</span>
                     <div className="flex-1 h-px bg-white/10" />
                   </div>
                   <button
                     type="button"
                     onClick={handleGoogle}
                     disabled={loading || !isOnline}
                     className="flex items-center justify-center w-full h-14 rounded-xl border border-white/10 bg-white/[0.03] text-white font-black uppercase tracking-[0.22em] text-[11px] hover:bg-white/[0.06] active:scale-[0.97] transition-all disabled:opacity-50"
                   >
                     Continue with Google
                   </button>
                 </>
               )}

               <div className="flex flex-col items-center gap-4 mt-2">
                 {mode === 'LOGIN' && (
                   <button
                     type="button"
                     onClick={() => setMode('RESET')}
                     className="group inline-flex items-center justify-center min-h-11 px-5 rounded-xl text-[11px] font-black uppercase tracking-[0.22em] text-neutral-400 border border-transparent hover:text-accent hover:border-white/[0.08] hover:bg-white/[0.03] active:scale-[0.97] transition-all duration-300"
                   >
                     <span className="border-b border-neutral-600/80 group-hover:border-accent/60 pb-px transition-colors duration-300">
                       Forgot password?
                     </span>
                   </button>
                 )}
                 {mode === 'RESET' && (
                   <button
                     type="button"
                     onClick={() => setMode('LOGIN')}
                     className="group inline-flex items-center justify-center min-h-11 px-5 rounded-xl text-[11px] font-black uppercase tracking-[0.22em] text-neutral-400 border border-transparent hover:text-white hover:border-white/[0.08] hover:bg-white/[0.03] active:scale-[0.97] transition-all duration-300"
                   >
                     <span className="border-b border-neutral-600/80 group-hover:border-white/50 pb-px transition-colors duration-300">
                       Return to sign in
                     </span>
                   </button>
                 )}
               </div>
             </form>
          </motion.div>
        </div>
      </div>
    </div>
  );
});
