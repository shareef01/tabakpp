import { motion, AnimatePresence } from 'framer-motion';
import { LogOut, AlertCircle, CheckCircle2, X } from 'lucide-react';
import { Button, Card } from '../Common';
import { useDialogA11y } from '../../hooks/useDialogA11y';

/**
 * Standardized Logout Modal
 */
export const LogoutModal = ({ isOpen, onClose, onConfirm }) => {
  const dialogRef = useDialogA11y(isOpen, onClose);
  return <AnimatePresence>
    {isOpen && (
      <div className="fixed inset-0 z-[5000] flex items-end sm:items-center justify-center p-0 sm:p-6 isolate">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-[#020202]/90 backdrop-blur-2xl"
        />
        <motion.div
          ref={dialogRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby="logout-title"
          aria-describedby="logout-desc"
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="relative w-full max-w-sm z-[5001] max-h-[min(92dvh,92vh)] overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:pb-0 px-6 sm:px-0"
        >
          <Card className="p-10 border-white/10 text-center" danger>
            <div className="flex flex-col items-center space-y-8">
              <div className="w-20 h-20 rounded-[28px] bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-500">
                <LogOut size={32} strokeWidth={2.5} />
              </div>
              <div className="space-y-2">
                <h3 id="logout-title" className="text-2xl font-[1000] uppercase tracking-tighter text-white">Sign out?</h3>
                <p id="logout-desc" className="text-xs font-black text-neutral-400 uppercase tracking-widest leading-relaxed px-4">
                  You will need to sign in again to access your data.
                </p>
              </div>
              <div className="flex flex-col w-full gap-3">
                <Button variant="danger" className="h-16" onClick={onConfirm}>
                  Sign out
                </Button>
                <Button variant="secondary" className="h-16" onClick={onClose}>
                  Cancel
                </Button>
              </div>
            </div>
          </Card>
        </motion.div>
      </div>
    )}
  </AnimatePresence>;
};

/**
 * Standardized Alert Overlay (Notification)
 */
export const AlertOverlay = ({ isOpen, onClose, title, message, type = 'error' }) => (
  <AnimatePresence>
    {isOpen && (
      <div className="fixed top-[max(2.5rem,calc(env(safe-area-inset-top)+0.75rem))] left-1/2 -translate-x-1/2 z-[10000] w-full max-w-sm px-6">
        <motion.div
          role={type === 'error' ? 'alert' : 'status'}
          aria-live={type === 'error' ? 'assertive' : 'polite'}
          initial={{ opacity: 0, y: -50, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          className="bg-[#0a0a0c] border border-white/10 rounded-3xl p-5 shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex items-center gap-5 backdrop-blur-xl"
        >
          <div className={`shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center ${type === 'error' ? 'bg-rose-500/10 text-rose-500' : 'bg-accent/10 text-accent'}`}>
            {type === 'error' ? <AlertCircle size={24} /> : <CheckCircle2 size={24} />}
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-black text-white uppercase tracking-tight">{title}</h4>
            <p className="text-xs font-bold text-neutral-400 uppercase tracking-widest line-clamp-3">{message}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Dismiss notification" className="min-w-11 min-h-11 flex items-center justify-center text-neutral-600 hover:text-white transition-colors">
            <X size={16} strokeWidth={3} />
          </button>
        </motion.div>
      </div>
    )}
  </AnimatePresence>
);
