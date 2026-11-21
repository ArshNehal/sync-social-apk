import React from 'react';
import { createPortal } from 'react-dom';
import { X, Check, UserPlus, Sparkles, LogIn, Trash2, Loader2, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../context/AuthContext';
import { Avatar } from './Avatar';
import { SavedAccount } from '../types';
import { soundFX } from '../lib/sounds';
import { WarningPopup } from './Modals';

export const AccountSwitcherModal: React.FC = () => {
  const {
    user,
    savedAccounts,
    accountSwitcherOpen,
    switchingAccountUid,
    closeAccountSwitcher,
    switchAccount,
    addNewAccount,
    removeSavedAccount,
    openAuth,
  } = useAuth();

  const [accountToRemove, setAccountToRemove] = React.useState<SavedAccount | null>(null);
  const [switchError, setSwitchError] = React.useState<string>('');
  const openedAtRef = React.useRef<number>(0);
  const pointerDownOnBackdropRef = React.useRef<boolean>(false);

  React.useEffect(() => {
    if (accountSwitcherOpen) {
      openedAtRef.current = Date.now();
      pointerDownOnBackdropRef.current = false;
      setSwitchError('');
    } else {
      setAccountToRemove(null);
      setSwitchError('');
    }
  }, [accountSwitcherOpen]);

  React.useEffect(() => {
    if (!accountSwitcherOpen || accountToRemove || switchingAccountUid) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAccountSwitcher();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [accountSwitcherOpen, accountToRemove, switchingAccountUid, closeAccountSwitcher]);

  const accounts: SavedAccount[] = React.useMemo(() => {
    const list = [...savedAccounts];
    if (user && !list.some((a) => a.uid === user.id)) {
      list.unshift({
        uid: user.id,
        email: user.email || '',
        username: user.username,
        display_name: user.display_name,
        avatar_url: user.avatar_url || '',
        is_verified: !!user.is_verified,
        lastUsedAt: Date.now(),
      });
    }
    return list;
  }, [savedAccounts, user]);

  const handleSelectAccount = async (acc: SavedAccount) => {
    if (switchingAccountUid) return;
    soundFX.playTap();
    setSwitchError('');
    if (user?.id === acc.uid) {
      closeAccountSwitcher();
      return;
    }
    const result = await switchAccount(acc);
    if (result.status === 'same_account' || result.status === 'error') {
      setSwitchError(result.message || 'Could not switch account.');
    }
  };

  if (typeof document === 'undefined') return null;

  const isBusy = !!switchingAccountUid;

  return createPortal(
    <AnimatePresence>
      {accountSwitcherOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-label="Switch Account"
          onPointerDown={(e) => {
            pointerDownOnBackdropRef.current = e.target === e.currentTarget;
          }}
          onClick={(e) => {
            if (isBusy) return;
            // Guard against releasing a mobile long-press gesture onto the newly mounted backdrop
            if (Date.now() - openedAtRef.current < 350) return;
            if (e.target === e.currentTarget && pointerDownOnBackdropRef.current) {
              closeAccountSwitcher();
            }
          }}
          className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-xl flex items-end sm:items-center justify-center p-0 sm:p-4"
        >
          <motion.div
            initial={{ y: 40, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 30, opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="glass-surface w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-5 sm:p-6 border border-white/15 shadow-2xl pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:pb-6 max-h-[85dvh] flex flex-col"
          >
            {/* Mobile grab bar */}
            <div className="w-10 h-1 rounded-full bg-white/20 mx-auto mb-3 sm:hidden" />

            <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-4">
              <div>
                <h3 className="text-base font-bold text-white">Switch Account</h3>
                <p className="text-[11px] text-zinc-400">
                  Switch between saved SYNC accounts or add another one
                </p>
              </div>
              <button
                type="button"
                disabled={isBusy}
                onClick={closeAccountSwitcher}
                aria-label="Close account switcher"
                className="w-9 h-9 flex items-center justify-center rounded-full text-zinc-400 hover:text-white hover:bg-white/10 transition cursor-pointer disabled:opacity-40"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {switchError && (
              <div className="mb-3 p-3 rounded-2xl bg-amber-500/10 border border-amber-500/25 text-amber-200 text-xs flex items-start gap-2.5 leading-relaxed">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                <span>{switchError}</span>
              </div>
            )}

            {/* Saved accounts list */}
            <div className="flex flex-col gap-2 overflow-y-auto pr-0.5 mb-4">
              {accounts.length === 0 ? (
                <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 text-center text-xs text-zinc-400">
                  No saved accounts yet. Sign in or create a new account to save it here.
                </div>
              ) : (
                accounts.map((acc) => {
                  const isActive = user?.id === acc.uid;
                  const isSwitchingThis = switchingAccountUid === acc.uid;
                  return (
                    <div
                      key={acc.uid}
                      className={`flex items-center justify-between gap-2 p-3 rounded-2xl border transition ${
                        isActive
                          ? 'bg-white/10 border-white/30'
                          : isSwitchingThis
                          ? 'bg-white/[0.08] border-white/25'
                          : 'bg-white/[0.03] border-white/10 hover:bg-white/[0.07]'
                      }`}
                    >
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleSelectAccount(acc)}
                        className="flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer disabled:cursor-wait"
                      >
                        <Avatar
                          userId={acc.uid}
                          name={acc.display_name}
                          url={acc.avatar_url}
                          size="md"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 text-sm font-semibold text-white truncate">
                            <span className="truncate">{acc.display_name}</span>
                            {acc.is_verified && (
                              <Sparkles className="w-3.5 h-3.5 text-zinc-300 shrink-0" />
                            )}
                          </div>
                          <div className="text-[11px] text-zinc-400 font-mono truncate">
                            @{acc.username}
                          </div>
                        </div>
                      </button>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {isActive ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white text-black text-[11px] font-bold shadow-sm">
                            <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                            <span>Active</span>
                          </span>
                        ) : (
                          <>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleSelectAccount(acc)}
                              className="px-3 py-1.5 min-w-[66px] rounded-xl bg-white/10 hover:bg-white text-white hover:text-black text-[11px] font-semibold transition cursor-pointer disabled:opacity-60 flex items-center justify-center gap-1.5"
                            >
                              {isSwitchingThis ? (
                                <>
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  <span>Switching</span>
                                </>
                              ) : (
                                <span>Switch</span>
                              )}
                            </button>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => setAccountToRemove(acc)}
                              aria-label={`Remove @${acc.username} from saved accounts`}
                              title="Remove from list"
                              className="w-9 h-9 flex items-center justify-center rounded-xl text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition cursor-pointer disabled:opacity-40"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Add / Create New Account Actions */}
            <div className="flex flex-col gap-2 pt-3 border-t border-white/10">
              <button
                type="button"
                disabled={isBusy}
                onClick={() => {
                  soundFX.playTap();
                  addNewAccount();
                }}
                className="glass-button-primary sheen-glow w-full min-h-[44px] py-2.5 px-4 text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <UserPlus className="w-4 h-4" />
                <span>Create New Account</span>
              </button>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => {
                  soundFX.playTap();
                  closeAccountSwitcher();
                  openAuth('login');
                }}
                className="w-full min-h-[42px] py-2 px-4 rounded-2xl bg-white/[0.04] hover:bg-white/[0.09] border border-white/10 text-xs font-medium text-zinc-300 hover:text-white flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50"
              >
                <LogIn className="w-4 h-4" />
                <span>Sign In to Another Account</span>
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
      <WarningPopup
        open={!!accountToRemove}
        title={accountToRemove ? `Remove @${accountToRemove.username}?` : 'Remove saved account?'}
        message="This only removes the quick-switch shortcut from this browser. The account itself is not deleted."
        confirmLabel="Remove"
        tone="warning"
        onCancel={() => setAccountToRemove(null)}
        onConfirm={() => {
          const target = accountToRemove;
          setAccountToRemove(null);
          if (target) removeSavedAccount(target.uid);
        }}
      />
    </AnimatePresence>,
    document.body
  );
};
