import React, { useState, useEffect } from 'react';
import {
  Shield,
  Lock,
  UserCheck,
  UserX,
  LogOut,
  Sparkles,
  Check,
  X,
  Smartphone,
  KeyRound,
  Eye,
  EyeOff,
  Trash2,
  AlertTriangle,
  Volume2,
  VolumeX,
  ArrowLeftRight,
  UserPlus,
  Star,
} from 'lucide-react';
import { FollowRequest, User } from '../types';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Avatar } from './Avatar';
import { soundFX } from '../lib/sounds';
import { CloseFriendsModal, WarningPopup } from './Modals';

export const SettingsView: React.FC<{
  onOpenProfile: (username: string) => void;
  onOpenInstallApp?: () => void;
  onOpenInvite?: () => void;
}> = ({
  onOpenProfile,
  onOpenInstallApp,
  onOpenInvite,
}) => {
  const {
    user,
    savedAccounts,
    openAccountSwitcher,
    updateProfile,
    deleteAccount,
    requestLogout,
    hasPasswordProvider,
    setAccountPassword,
    removeAccountPassword,
    showToast,
    brandName,
  } = useAuth();
  const [isPrivate, setIsPrivate] = useState(!!user?.is_private);
  const [followRequests, setFollowRequests] = useState<FollowRequest[]>([]);
  const [blockedUsers, setBlockedUsers] = useState<User[]>([]);
  const [savingPrivacy, setSavingPrivacy] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(() => soundFX.isEnabled());

  // Password management state
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  // Delete account confirmation state
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [closeFriendsModalOpen, setCloseFriendsModalOpen] = useState(false);
  const [removePwdConfirmOpen, setRemovePwdConfirmOpen] = useState(false);

  useEffect(() => {
    setIsPrivate(!!user?.is_private);
  }, [user?.is_private]);

  useEffect(() => {
    return soundFX.subscribe(setSoundEnabled);
  }, []);

  useEffect(() => {
    if (user?.is_private) {
      api.getFollowRequests().then((res) => setFollowRequests(res.requests)).catch(() => {});
    }
    api.getBlockedUsers().then((res) => setBlockedUsers(res.users)).catch(() => {});
  }, [user]);

  useEffect(() => {
    if (!deleteModalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !deletingAccount) setDeleteModalOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deleteModalOpen, deletingAccount]);

  const handleTogglePrivacy = async () => {
    if (savingPrivacy) return;
    const prevVal = isPrivate;
    const nextVal = !prevVal;
    // Flip optimistically for instant UI response
    setIsPrivate(nextVal);
    setSavingPrivacy(true);
    try {
      await updateProfile({ is_private: nextVal }, { silentToast: true });
      showToast(nextVal ? 'Account set to Private' : 'Account is now Public');
    } catch {
      setIsPrivate(prevVal);
      showToast('Could not update privacy setting');
    } finally {
      setSavingPrivacy(false);
    }
  };

  const handleAcceptRequest = async (reqId: string) => {
    try {
      await api.acceptFollowRequest(reqId);
      setFollowRequests((prev) => prev.filter((r) => r.id !== reqId));
      showToast('Follow request approved');
    } catch (e) {
      showToast('Action failed');
    }
  };

  const handleRejectRequest = async (reqId: string) => {
    try {
      await api.rejectFollowRequest(reqId);
      setFollowRequests((prev) => prev.filter((r) => r.id !== reqId));
      showToast('Request dismissed');
    } catch (e) {
      showToast('Action failed');
    }
  };

  const handleUnblock = async (userId: string) => {
    try {
      await api.unblockUser(userId);
      setBlockedUsers((prev) => prev.filter((u) => u.id !== userId));
      showToast('Account unblocked');
    } catch (e) {
      showToast('Action failed');
    }
  };

  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    if (newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match.');
      return;
    }
    setSavingPassword(true);
    try {
      await setAccountPassword(newPassword);
      setNewPassword('');
      setConfirmPassword('');
      showToast(hasPasswordProvider ? 'Account password updated' : 'Account password saved');
    } catch (err: any) {
      setPasswordError(err?.message || 'Could not update password');
    } finally {
      setSavingPassword(false);
    }
  };

  const handleRemovePassword = async () => {
    setPasswordError('');
    setSavingPassword(true);
    try {
      await removeAccountPassword();
      setNewPassword('');
      setConfirmPassword('');
      showToast('Account password removed');
    } catch (err: any) {
      setPasswordError(err?.message || 'Could not remove password');
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto pb-16">
      <h2 className="text-lg font-bold text-white tracking-wide mb-6 pb-4 border-b border-white/10">
        Account & Privacy Settings
      </h2>

      {/* Accounts & Quick Switcher */}
      <div className="glass-card rounded-3xl p-5 sm:p-6 border border-white/10 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar
              userId={user?.id}
              name={user?.display_name || 'Account'}
              url={user?.avatar_url}
              size="md"
            />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-white truncate">Accounts &amp; Switcher</h3>
              <p className="text-xs text-zinc-400 mt-0.5 truncate">
                {savedAccounts.length > 1
                  ? `${savedAccounts.length} saved accounts ready for quick switching`
                  : `Signed in as @${user?.username || 'member'} — add or create another account`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              soundFX.playTap();
              openAccountSwitcher();
            }}
            className="glass-button-primary px-4 min-h-[40px] rounded-2xl text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer shrink-0 whitespace-nowrap"
          >
            <ArrowLeftRight className="w-4 h-4" />
            <span>Switch / Add Account</span>
          </button>
        </div>
      </div>

      {/* Invite & Connect Friends (accessible on mobile) */}
      {onOpenInvite && (
        <div className="glass-card rounded-3xl p-5 sm:p-6 border border-white/10 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className="p-2 rounded-xl bg-white/10 text-white shrink-0">
                <UserPlus className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-white">Invite &amp; Connect</h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Share your direct @{user?.username || 'sync'} profile link with friends on WhatsApp, Telegram, or SMS.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                soundFX.playTap();
                onOpenInvite();
              }}
              className="glass-pill px-4 min-h-[40px] rounded-2xl text-xs font-semibold text-white hover:bg-white/15 flex items-center justify-center gap-2 cursor-pointer shrink-0 whitespace-nowrap"
            >
              <UserPlus className="w-4 h-4" />
              <span>Invite Friends</span>
            </button>
          </div>
        </div>
      )}

      {/* Close Friends Management */}
      <div className="glass-card rounded-3xl p-5 sm:p-6 border border-white/10 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="p-2 rounded-xl bg-emerald-500/15 border border-emerald-400/25 text-emerald-400 shrink-0">
              <Star className="w-5 h-5 fill-emerald-400" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-white">Close Friends</h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                Choose who sees your private Close Friends stories with an emerald ring.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              soundFX.playTap();
              setCloseFriendsModalOpen(true);
            }}
            className="glass-pill px-4 min-h-[40px] rounded-2xl text-xs font-semibold text-white hover:bg-white/15 flex items-center justify-center gap-2 cursor-pointer shrink-0 whitespace-nowrap"
          >
            <Star className="w-4 h-4 text-emerald-400" />
            <span>Manage List</span>
          </button>
        </div>
      </div>

      {/* Account Privacy Toggle */}
      <div className="glass-card rounded-3xl p-5 sm:p-6 border border-white/10 mb-6">
        <div className="flex items-center justify-between gap-4 mb-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-xl bg-white/10 text-white shrink-0">
              <Lock className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-white">Private Account</h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                When private, only users you approve can view your posts and stories.
              </p>
            </div>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={isPrivate}
            aria-label="Toggle private account"
            onClick={handleTogglePrivacy}
            className={`w-12 h-6 rounded-full transition-colors duration-150 relative cursor-pointer shrink-0 ${
              isPrivate ? 'bg-white' : 'bg-zinc-800'
            }`}
          >
            <span
              className={`w-5 h-5 rounded-full transition-transform duration-150 absolute top-0.5 left-0.5 ${
                isPrivate ? 'translate-x-6 bg-black' : 'translate-x-0 bg-zinc-400'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Sound Effects Toggle */}
      <div className="glass-card rounded-3xl p-5 sm:p-6 border border-white/10 mb-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-xl bg-white/10 text-white shrink-0">
              {soundEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5 text-zinc-400" />}
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-white">Sound Effects</h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                Subtle low-volume tactile audio for messages, likes, and navigation.
              </p>
            </div>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={soundEnabled}
            aria-label="Toggle sound effects"
            onClick={() => {
              const next = !soundEnabled;
              soundFX.setEnabled(next);
              showToast(next ? 'Sound effects enabled' : 'Sound effects muted');
            }}
            className={`w-12 h-6 rounded-full transition-colors duration-150 relative cursor-pointer shrink-0 ${
              soundEnabled ? 'bg-white' : 'bg-zinc-800'
            }`}
          >
            <span
              className={`w-5 h-5 rounded-full transition-transform duration-150 absolute top-0.5 left-0.5 ${
                soundEnabled ? 'translate-x-6 bg-black' : 'translate-x-0 bg-zinc-400'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Pending Follow Requests */}
      {isPrivate && (
        <div className="glass-card rounded-3xl p-5 sm:p-6 border border-white/10 mb-6">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center justify-between">
            <span>Pending Follow Requests</span>
            <span className="text-xs font-mono tabular-nums text-zinc-500">{followRequests.length}</span>
          </h3>

          {followRequests.length === 0 ? (
            <p className="text-xs text-zinc-500 py-3">No pending follow requests.</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {followRequests.map((fr) => (
                <div
                  key={fr.id}
                  className="flex items-center justify-between gap-3 p-3 rounded-2xl glass-surface"
                >
                  <div
                    onClick={() => onOpenProfile(fr.username)}
                    className="flex items-center gap-3 cursor-pointer min-w-0 flex-1"
                  >
                    <Avatar
                      userId={fr.requester_id}
                      name={fr.display_name}
                      url={fr.avatar_url}
                      size="sm"
                    />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-white truncate">{fr.display_name}</div>
                      <div className="text-[10px] text-zinc-500 font-mono truncate">@{fr.username}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleAcceptRequest(fr.id)}
                      className="w-10 h-10 flex items-center justify-center rounded-xl bg-white text-black hover:bg-zinc-200 transition"
                      title="Accept"
                      aria-label="Accept follow request"
                    >
                      <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                    </button>
                    <button
                      onClick={() => handleRejectRequest(fr.id)}
                      className="w-10 h-10 flex items-center justify-center rounded-xl bg-white/10 text-zinc-400 hover:text-white transition"
                      title="Decline"
                      aria-label="Decline follow request"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Blocked Accounts */}
      <div className="glass-card rounded-3xl p-5 sm:p-6 border border-white/10 mb-6">
        <h3 className="text-sm font-semibold text-white mb-3">Blocked Accounts</h3>
        {blockedUsers.length === 0 ? (
          <p className="text-xs text-zinc-500 py-2">You haven't blocked any accounts.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {blockedUsers.map((bu) => (
              <div
                key={bu.id}
                className="flex items-center justify-between gap-3 p-3 rounded-2xl glass-surface"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <Avatar
                    userId={bu.id}
                    name={bu.display_name}
                    url={bu.avatar_url}
                    size="xs"
                  />
                  <div className="min-w-0 flex items-center flex-wrap gap-x-1.5">
                    <span className="text-xs font-semibold text-white truncate">{bu.display_name}</span>
                    <span className="text-[10px] text-zinc-500 font-mono truncate">@{bu.username}</span>
                  </div>
                </div>
                <button
                  onClick={() => handleUnblock(bu.id)}
                  className="px-3.5 py-2 rounded-xl glass-pill text-xs text-zinc-300 hover:text-white shrink-0"
                >
                  Unblock
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Mobile Application & Android APK */}
      <div className="glass-card rounded-3xl p-5 sm:p-6 border border-white/10 mb-6">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white mb-1">Mobile Application & Android APK</h3>
            <p className="text-xs text-zinc-400 max-w-md">
              Download the complete Android Studio repository, compile your own release APK, or install directly onto your device.
            </p>
          </div>
        </div>
        {onOpenInstallApp && (
          <button
            onClick={onOpenInstallApp}
            className="mt-4 glass-button-primary px-4 py-2.5 rounded-2xl text-xs font-semibold flex items-center gap-2 cursor-pointer"
          >
            <Smartphone className="w-4 h-4" />
            <span>Open Mobile App Center</span>
          </button>
        )}
      </div>

      {/* Security & Cloud Persistence */}
      <div className="glass-card rounded-3xl p-5 sm:p-6 border border-white/10 mb-6">
        <div className="flex items-center gap-2.5 mb-2">
          <Shield className="w-4 h-4 text-zinc-300 shrink-0" />
          <h3 className="text-sm font-semibold text-white">Account & Cloud Persistence</h3>
        </div>
        <p className="text-xs text-zinc-400 mb-3 break-words">
          Signed in with: <span className="font-mono text-white break-all">{user?.email}</span>
        </p>
        <p className="text-xs text-zinc-500">
          Your session stays active across browser restarts and all posts, comments, likes, stories, and messages are stored persistently in the cloud.
        </p>
      </div>

      {/* Password & Sign-In Credentials */}
      <div className="glass-card rounded-3xl p-5 sm:p-6 border border-white/10 mb-6">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <KeyRound className="w-4 h-4 text-zinc-300 shrink-0" />
            <h3 className="text-sm font-semibold text-white truncate">
              {hasPasswordProvider ? 'Update Account Password' : 'Add a Password'}
            </h3>
          </div>
          <span className="text-[10px] font-mono px-2.5 py-0.5 rounded-full bg-white/5 border border-white/10 text-zinc-400 shrink-0">
            {hasPasswordProvider ? 'Password Active' : 'Google Only'}
          </span>
        </div>
        <p className="text-xs text-zinc-400 mb-4">
          {hasPasswordProvider
            ? 'Your account requires this password whenever you sign back in after logging out.'
            : 'Optionally set an encrypted password to lock your account when signing back in.'}
        </p>

        {passwordError && (
          <div className="mb-3 p-2.5 rounded-xl bg-red-500/10 border border-red-500/25 text-red-300 text-xs">
            {passwordError}
          </div>
        )}

        <form onSubmit={handleSavePassword} className="flex flex-col gap-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="relative w-full min-w-0">
              <input
                type={showPwd ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={hasPasswordProvider ? 'New password (min 6 chars)' : 'Create password (min 6 chars)'}
                className="glass-input w-full h-11 px-3.5 pr-10 rounded-xl text-xs"
              />
              <button
                type="button"
                onClick={() => setShowPwd((v) => !v)}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-white cursor-pointer"
                aria-label={showPwd ? 'Hide password' : 'Show password'}
              >
                {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <div className="relative w-full min-w-0">
              <input
                type={showPwd ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm password"
                className="glass-input w-full h-11 px-3.5 pr-10 rounded-xl text-xs"
              />
              <button
                type="button"
                onClick={() => setShowPwd((v) => !v)}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-white cursor-pointer"
                aria-label={showPwd ? 'Hide password' : 'Show password'}
              >
                {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          {newPassword && confirmPassword && newPassword !== confirmPassword && (
            <p className="text-[11px] text-amber-300">Passwords do not match yet.</p>
          )}
          <div className="flex items-center justify-end gap-2">
            {hasPasswordProvider && (
              <button
                type="button"
                onClick={() => setRemovePwdConfirmOpen(true)}
                disabled={savingPassword}
                className="px-4 py-2 rounded-xl text-xs text-zinc-400 hover:text-red-300 hover:bg-red-500/10 transition cursor-pointer disabled:opacity-40"
              >
                Remove Password
              </button>
            )}
            <button
              type="submit"
              disabled={savingPassword || newPassword.length < 6 || newPassword !== confirmPassword}
              className="glass-button-primary px-5 py-2 text-xs font-semibold disabled:opacity-40 cursor-pointer"
            >
              {savingPassword
                ? 'Saving...'
                : hasPasswordProvider
                ? 'Update Password'
                : 'Set Password'}
            </button>
          </div>
        </form>
      </div>

      {/* Sign Out Section */}
      <div className="glass-card rounded-3xl p-5 sm:p-6 border border-white/10 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-white/10 text-zinc-200 shrink-0">
              <LogOut className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">Sign Out</h3>
              <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">
                End your session on this browser. Your account, posts, and messages stay safely saved in the cloud.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={requestLogout}
            className="flex items-center justify-center gap-2 px-5 min-h-[40px] rounded-2xl bg-white/[0.06] hover:bg-white/15 text-white border border-white/15 text-xs font-semibold transition cursor-pointer shrink-0 active:scale-95 whitespace-nowrap"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out of {brandName || 'SYNC'}</span>
          </button>
        </div>
      </div>

      {/* Delete Account Section */}
      <div className="glass-card rounded-3xl p-5 sm:p-6 border border-red-500/25 bg-red-500/[0.03] mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-red-500/15 text-red-400 shrink-0">
              <Trash2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">Delete Account</h3>
              <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">
                Permanently remove your @{user?.username} profile, posts, comments, likes, stories, and saved credentials. This action cannot be undone.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setDeleteConfirmInput('');
              setDeleteError('');
              setDeleteModalOpen(true);
            }}
            className="flex items-center justify-center gap-2 px-5 min-h-[40px] rounded-2xl bg-red-500/15 text-red-300 border border-red-500/30 hover:bg-red-500/25 text-xs font-semibold transition cursor-pointer shrink-0 active:scale-95 whitespace-nowrap"
          >
            <Trash2 className="w-4 h-4" />
            <span>Delete Account</span>
          </button>
        </div>
      </div>

      {/* Delete Account Confirmation Modal */}
      {deleteModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget && !deletingAccount) {
              setDeleteModalOpen(false);
            }
          }}
          className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-xl flex items-center justify-center p-4"
        >
          <div className="glass-surface w-full max-w-md rounded-3xl p-6 border border-red-500/30 relative shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-4">
              <div className="flex items-center gap-2.5 text-red-400">
                <AlertTriangle className="w-5 h-5" />
                <h3 className="text-sm font-semibold text-white">Delete Account Permanently?</h3>
              </div>
              <button
                type="button"
                onClick={() => !deletingAccount && setDeleteModalOpen(false)}
                aria-label="Close delete account confirmation"
                className="w-9 h-9 flex items-center justify-center rounded-full text-zinc-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex flex-col gap-3 text-xs text-zinc-300 leading-relaxed mb-5">
              <p>
                This will permanently delete <strong className="text-white">@{user?.username}</strong> along with all of your posts, comments, likes, stories, bookmarks, follows, and account credentials.
              </p>
              <div className="p-3 rounded-2xl bg-red-500/10 border border-red-500/25 text-red-200">
                Type <strong className="font-mono text-white">DELETE</strong> below to confirm permanent account deletion.
              </div>
              {deleteError && (
                <div className="p-2.5 rounded-xl bg-red-500/15 border border-red-500/30 text-red-300 text-xs">
                  {deleteError}
                </div>
              )}
              <input
                type="text"
                value={deleteConfirmInput}
                onChange={(e) => setDeleteConfirmInput(e.target.value)}
                placeholder="Type DELETE to confirm"
                className="glass-input w-full h-10 px-3.5 rounded-xl text-xs font-mono"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/10">
              <button
                type="button"
                onClick={() => setDeleteModalOpen(false)}
                disabled={deletingAccount}
                className="px-4 py-2 rounded-xl text-xs font-medium text-zinc-300 hover:text-white hover:bg-white/5 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deletingAccount || deleteConfirmInput.trim().toUpperCase() !== 'DELETE'}
                onClick={async () => {
                  setDeleteError('');
                  setDeletingAccount(true);
                  try {
                    await deleteAccount();
                    setDeleteModalOpen(false);
                  } catch (err: any) {
                    setDeleteError(err?.message || 'Could not delete account');
                  } finally {
                    setDeletingAccount(false);
                  }
                }}
                className="px-5 py-2 rounded-2xl bg-red-500/25 text-red-200 border border-red-500/40 text-xs font-semibold hover:bg-red-500/35 transition disabled:opacity-40 cursor-pointer"
              >
                {deletingAccount ? 'Deleting Account...' : 'Permanently Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {closeFriendsModalOpen && (
        <CloseFriendsModal onClose={() => setCloseFriendsModalOpen(false)} />
      )}

      <WarningPopup
        open={removePwdConfirmOpen}
        title="Remove account password?"
        message="You will be able to sign in directly with Google without entering a password lock."
        confirmLabel="Remove"
        tone="warning"
        loading={savingPassword}
        loadingLabel="Removing..."
        onCancel={() => !savingPassword && setRemovePwdConfirmOpen(false)}
        onConfirm={async () => {
          await handleRemovePassword();
          setRemovePwdConfirmOpen(false);
        }}
      />
    </div>
  );
};
