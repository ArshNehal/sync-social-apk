import React, { useState } from 'react';
import { X, ShieldCheck, AlertTriangle, Upload, Eye, EyeOff, Lock, Check, KeyRound } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { Logo } from './Logo';
import { Avatar } from './Avatar';

function formatAuthError(err: any): string {
  const code = err?.code || '';
  if (code === 'auth/popup-closed-by-user') {
    return 'Sign-in window was closed before completing.';
  }
  if (code === 'auth/popup-blocked') {
    return 'Popup was blocked by your browser. Please allow popups for this site and try again.';
  }
  const msg = typeof err?.message === 'string' ? err.message : '';
  if (msg.startsWith('{') && msg.includes('"error"')) {
    try {
      const parsed = JSON.parse(msg);
      if (parsed?.error) {
        return `Unable to set up your profile (${parsed.error}). Please try signing in again.`;
      }
    } catch {}
  }
  return msg || 'Unable to complete authentication.';
}

export const AuthModal: React.FC = () => {
  const {
    authModalOpen,
    authModalTab,
    pendingPasswordUser,
    closeAuth,
    signInWithGoogle,
    verifyAndUnlockPassword,
    resetPasswordViaGoogle,
    cancelPendingPasswordSignIn,
    setAccountPassword,
    updateProfile,
    storagePersistent,
    brandName,
    showToast,
  } = useAuth();

  const [tab, setTab] = useState<'login' | 'register'>(authModalTab);
  const [step, setStep] = useState<'auth' | 'setup' | 'verify'>('auth');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [customizeAfterGoogle, setCustomizeAfterGoogle] = useState(true);

  // Post-Google profile & password setup state
  const [avatarUrl, setAvatarUrl] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // Password verify / reset state
  const [verifyPwd, setVerifyPwd] = useState('');
  const [showVerifyPwd, setShowVerifyPwd] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [newResetPwd, setNewResetPwd] = useState('');
  const [confirmResetPwd, setConfirmResetPwd] = useState('');

  React.useEffect(() => {
    if (pendingPasswordUser) {
      setStep('verify');
      setError('');
      setVerifyPwd('');
      setResetMode(false);
      setNewResetPwd('');
      setConfirmResetPwd('');
      return;
    }
    setTab(authModalTab);
    setStep('auth');
    setError('');
    setPassword('');
    setConfirmPassword('');
    setVerifyPwd('');
    setResetMode(false);
    setCustomizeAfterGoogle(authModalTab === 'register');
  }, [authModalTab, authModalOpen, pendingPasswordUser]);

  const handleClose = React.useCallback(async () => {
    if (loading) return;
    if (step === 'verify' && pendingPasswordUser) {
      await cancelPendingPasswordSignIn();
    } else {
      closeAuth();
    }
  }, [loading, step, pendingPasswordUser, cancelPendingPasswordSignIn, closeAuth]);

  React.useEffect(() => {
    if (!authModalOpen && !pendingPasswordUser) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [authModalOpen, pendingPasswordUser, handleClose]);

  if (!authModalOpen && !pendingPasswordUser) return null;

  const handleGoogleAuth = async () => {
    setError('');
    setLoading(true);
    try {
      const { user: profile, isNewUser, passwordRequired, previousUid } = await signInWithGoogle();
      if (passwordRequired) {
        setStep('verify');
        return;
      }
      if (tab === 'register' && !isNewUser) {
        if (previousUid && profile.id === previousUid) {
          setError(
            `That Google account is already linked to @${profile.username}. To create a separate account, click above and choose "Use another account" in Google.`
          );
          return;
        }
        closeAuth();
        showToast(`Switched to existing account @${profile.username}`);
        return;
      }
      if (isNewUser || customizeAfterGoogle) {
        setAvatarUrl(profile.avatar_url || '');
        setDisplayName(profile.display_name || '');
        setUsername(profile.username || '');
        setStep('setup');
      } else {
        closeAuth();
        showToast(
          previousUid && previousUid !== profile.id
            ? `Switched to @${profile.username}`
            : `Welcome back to ${brandName || 'SYNC'}, ${profile.display_name}`
        );
      }
    } catch (err: any) {
      setError(formatAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingAvatar(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64 = reader.result as string;
        const res = await api.uploadImage(base64);
        setAvatarUrl(res.url);
      } catch {
        setError('Could not process the selected image.');
      } finally {
        setUploadingAvatar(false);
      }
    };
    reader.onerror = () => {
      setError('Could not read the selected image file.');
      setUploadingAvatar(false);
    };
    reader.readAsDataURL(file);
  };

  const handleSaveSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9_.]/g, '');
    if (cleanUsername.length < 3 || cleanUsername.length > 20) {
      setError('Username must be 3–20 characters (lowercase letters, numbers, _ or .).');
      return;
    }
    if (!displayName.trim()) {
      setError('Display name cannot be empty.');
      return;
    }
    if (password || confirmPassword) {
      if (password.length < 6) {
        setError('Password must be at least 6 characters.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
    }

    setLoading(true);
    try {
      await updateProfile({
        avatar_url: avatarUrl,
        display_name: displayName.trim().slice(0, 80),
        username: cleanUsername,
      });

      if (password) {
        await setAccountPassword(password);
      }

      closeAuth();
      showToast(`Welcome to ${brandName || 'SYNC'}, ${displayName.trim()}`);
    } catch (err: any) {
      setError(formatAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!verifyPwd) {
      setError('Please enter your account password.');
      return;
    }
    setLoading(true);
    try {
      const ok = await verifyAndUnlockPassword(verifyPwd);
      if (!ok) {
        setError('Incorrect password. Please try again.');
        setLoading(false);
        return;
      }
      const name = pendingPasswordUser?.display_name || 'back';
      closeAuth();
      showToast(`Welcome back to ${brandName || 'SYNC'}, ${name}`);
    } catch (err: any) {
      setError(formatAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newResetPwd.length < 6) {
      setError('New password must be at least 6 characters.');
      return;
    }
    if (newResetPwd !== confirmResetPwd) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      await resetPasswordViaGoogle(newResetPwd);
      const name = pendingPasswordUser?.display_name || 'back';
      closeAuth();
      showToast(`Password updated. Welcome back, ${name}`);
    } catch (err: any) {
      setError(formatAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Authentication"
        onClick={(e) => {
          if (e.target === e.currentTarget && !loading) handleClose();
        }}
        className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-2xl flex items-center justify-center p-4 overflow-y-auto"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 10 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="glass-surface w-full max-w-md rounded-3xl p-6 md:p-8 border border-white/15 relative shadow-2xl my-auto"
        >
          {/* Close Button */}
          <button
            onClick={handleClose}
            aria-label="Close authentication modal"
            className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center rounded-full text-zinc-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>

          {step === 'auth' && (
            <>
              {/* Brand header */}
              <div className="flex flex-col items-center text-center mb-6">
                <Logo size="lg" />
                <p className="text-xs text-zinc-400 mt-2 font-light tracking-wide">
                  A social space. Without the noise.
                </p>
              </div>

              {/* Tab switchers */}
              <div className="flex items-center rounded-2xl bg-white/[0.04] p-1 border border-white/10 mb-6">
                <button
                  type="button"
                  onClick={() => {
                    setTab('login');
                    setError('');
                    setCustomizeAfterGoogle(false);
                  }}
                  className={`flex-1 py-2 rounded-xl text-xs font-semibold transition cursor-pointer ${
                    tab === 'login'
                      ? 'bg-white text-black shadow-md'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTab('register');
                    setError('');
                    setCustomizeAfterGoogle(true);
                  }}
                  className={`flex-1 py-2 rounded-xl text-xs font-semibold transition cursor-pointer ${
                    tab === 'register'
                      ? 'bg-white text-black shadow-md'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  Create Account
                </button>
              </div>

              {error && (
                <div className="mb-4 p-3 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-300 text-xs">
                  {error}
                </div>
              )}

              {!storagePersistent && (
                <div className="mb-4 p-3 rounded-2xl bg-amber-500/10 border border-amber-500/25 text-amber-200 text-xs flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                  <span>
                    Your browser is blocking local storage (such as Incognito or strict cookie settings). Your posts and data remain saved in your Google account, but you may need to sign in again after closing the browser.
                  </span>
                </div>
              )}

              <div className="flex flex-col gap-4">
                <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-4 text-center">
                  <p className="text-xs text-zinc-300 leading-relaxed">
                    {tab === 'register'
                      ? 'Connect your Google account, then customize your profile photo, display name, @username, and password right here.'
                      : 'Sign in with Google to restore your account, posts, likes, comments, stories, and messages.'}
                  </p>
                </div>

                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  type="button"
                  onClick={handleGoogleAuth}
                  disabled={loading}
                  className="glass-button-primary sheen-glow w-full py-3.5 px-4 text-xs font-semibold flex items-center justify-center gap-3 cursor-pointer disabled:opacity-50"
                >
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fill="#4285F4"
                      d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                    />
                  </svg>
                  <span>
                    {loading
                      ? 'Connecting...'
                      : tab === 'register'
                      ? 'Create Account with Google'
                      : 'Continue with Google'}
                  </span>
                </motion.button>

                <label className="flex items-center justify-center gap-2 text-[11px] text-zinc-400 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={customizeAfterGoogle}
                    onChange={(e) => setCustomizeAfterGoogle(e.target.checked)}
                    className="accent-white rounded"
                  />
                  <span>Customize photo, display name, username &amp; password after connecting</span>
                </label>

                <div className="flex items-center justify-center gap-2 text-[11px] text-zinc-500 pt-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Persistent cloud session across browser restarts</span>
                </div>
              </div>
            </>
          )}

          {step === 'setup' && (
            /* ================= STEP 2: PROFILE PIC, DISPLAY NAME, USERNAME & PASSWORD ================= */
            <form onSubmit={handleSaveSetup} className="flex flex-col gap-4">
              <div className="text-center mb-1">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 border border-white/15 text-[11px] font-medium text-zinc-200 mb-2">
                  <Check className="w-3 h-3 text-emerald-400" />
                  <span>Google Account Connected</span>
                </div>
                <h3 className="text-base font-bold text-white">Customize Your Profile</h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Upload a profile picture, pick your display name &amp; @username, and optionally set an account password.
                </p>
              </div>

              {error && (
                <div className="p-3 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-300 text-xs leading-relaxed">
                  {error}
                </div>
              )}

              {/* Profile Pic Upload */}
              <div className="flex items-center gap-4 p-3 rounded-2xl bg-white/[0.03] border border-white/10">
                <div className="relative w-16 h-16 rounded-2xl overflow-hidden border border-white/20 bg-black shrink-0 flex items-center justify-center">
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt="Profile preview"
                      referrerPolicy="no-referrer"
                      onError={() => setAvatarUrl('')}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Avatar name={displayName || username || 'Member'} size="lg" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-white mb-1.5">Profile Picture</div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <label className="px-3 py-1.5 rounded-xl glass-pill text-xs text-white hover:bg-white/15 cursor-pointer inline-flex items-center gap-1.5">
                      <Upload className="w-3.5 h-3.5" />
                      <span>{uploadingAvatar ? 'Uploading...' : 'Upload Photo'}</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleAvatarUpload}
                        className="hidden"
                      />
                    </label>
                    {avatarUrl && (
                      <button
                        type="button"
                        onClick={() => setAvatarUrl('')}
                        className="px-2.5 py-1.5 rounded-xl text-[11px] text-zinc-400 hover:text-white transition"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-zinc-300 block mb-1">Display Name</label>
                  <input
                    type="text"
                    required
                    maxLength={80}
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Your full name"
                    className="glass-input w-full px-3 py-2.5 rounded-xl text-xs"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-300 block mb-1">Username</label>
                  <input
                    type="text"
                    required
                    minLength={3}
                    maxLength={20}
                    value={username}
                    onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, ''))}
                    placeholder="username"
                    className="glass-input w-full px-3 py-2.5 rounded-xl text-xs font-mono"
                  />
                </div>
              </div>

              <div className="p-3.5 rounded-2xl bg-white/[0.02] border border-white/10 flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-200">
                    <Lock className="w-3.5 h-3.5 text-zinc-400" />
                    <span>Set Account Password (Optional)</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="text-[11px] text-zinc-400 hover:text-white flex items-center gap-1 cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    <span>{showPassword ? 'Hide' : 'Show'}</span>
                  </button>
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Create password (min 6 characters)"
                  className="glass-input w-full px-3 py-2 rounded-xl text-xs"
                />
                {password.length > 0 && (
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm password"
                    className="glass-input w-full px-3 py-2 rounded-xl text-xs"
                  />
                )}
                <p className="text-[11px] text-zinc-500 leading-relaxed">
                  Adds an encrypted password lock to protect your account whenever you sign back in.
                </p>
              </div>

              <div className="flex items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    closeAuth();
                    showToast(`Welcome to ${brandName || 'SYNC'}, ${displayName || username}`);
                  }}
                  className="px-4 py-2 text-xs text-zinc-400 hover:text-white transition cursor-pointer"
                >
                  Skip for now
                </button>
                <motion.button
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  type="submit"
                  disabled={loading || uploadingAvatar}
                  className="glass-button-primary px-6 py-2.5 text-xs font-semibold disabled:opacity-50 cursor-pointer"
                >
                  {loading ? 'Saving...' : 'Save & Continue'}
                </motion.button>
              </div>
            </form>
          )}

          {step === 'verify' && pendingPasswordUser && (
            /* ================= STEP 3: VERIFY ACCOUNT PASSWORD ON SIGN IN ================= */
            <div className="flex flex-col gap-4">
              <div className="flex flex-col items-center text-center">
                <Avatar
                  name={pendingPasswordUser.display_name}
                  url={pendingPasswordUser.avatar_url}
                  size="lg"
                />
                <div className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-white">
                  <KeyRound className="w-3.5 h-3.5 text-zinc-300" />
                  <span>{resetMode ? 'Reset Account Password' : 'Enter Account Password'}</span>
                </div>
                <p className="text-[11px] text-zinc-400 font-mono mt-0.5">
                  @{pendingPasswordUser.username}
                </p>
              </div>

              {error && (
                <div className="p-3 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-300 text-xs">
                  {error}
                </div>
              )}

              {!resetMode ? (
                <form onSubmit={handleVerifySubmit} className="flex flex-col gap-3">
                  <div className="relative">
                    <input
                      type={showVerifyPwd ? 'text' : 'password'}
                      autoFocus
                      required
                      value={verifyPwd}
                      onChange={(e) => setVerifyPwd(e.target.value)}
                      placeholder="Enter your account password"
                      className="glass-input w-full h-11 pl-3.5 pr-10 rounded-xl text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => setShowVerifyPwd((v) => !v)}
                      aria-label={showVerifyPwd ? 'Hide password' : 'Show password'}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-white cursor-pointer"
                    >
                      {showVerifyPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>

                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    type="submit"
                    disabled={loading}
                    className="glass-button-primary w-full py-2.5 text-xs font-semibold disabled:opacity-50 cursor-pointer"
                  >
                    {loading ? 'Verifying...' : `Unlock ${brandName || 'SYNC'}`}
                  </motion.button>

                  <div className="flex items-center justify-between pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setError('');
                        setResetMode(true);
                      }}
                      className="text-[11px] text-zinc-400 hover:text-white transition cursor-pointer"
                    >
                      Forgot password? Reset via Google
                    </button>
                    <button
                      type="button"
                      onClick={handleClose}
                      className="text-[11px] text-zinc-500 hover:text-zinc-300 transition cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <form onSubmit={handleResetPasswordSubmit} className="flex flex-col gap-3">
                  <p className="text-xs text-zinc-400 text-center">
                    Confirm your Google account to set a new password.
                  </p>
                  <input
                    type={showVerifyPwd ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={newResetPwd}
                    onChange={(e) => setNewResetPwd(e.target.value)}
                    placeholder="New password (min 6 characters)"
                    className="glass-input w-full px-3.5 py-2.5 rounded-xl text-xs"
                  />
                  <input
                    type={showVerifyPwd ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={confirmResetPwd}
                    onChange={(e) => setConfirmResetPwd(e.target.value)}
                    placeholder="Confirm new password"
                    className="glass-input w-full px-3.5 py-2.5 rounded-xl text-xs"
                  />
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    type="submit"
                    disabled={loading}
                    className="glass-button-primary w-full py-2.5 text-xs font-semibold disabled:opacity-50 cursor-pointer"
                  >
                    {loading ? 'Confirming with Google...' : 'Verify Google & Save Password'}
                  </motion.button>
                  <button
                    type="button"
                    onClick={() => {
                      setError('');
                      setResetMode(false);
                    }}
                    className="text-[11px] text-zinc-400 hover:text-white transition cursor-pointer"
                  >
                    Back to password entry
                  </button>
                </form>
              )}
            </div>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
