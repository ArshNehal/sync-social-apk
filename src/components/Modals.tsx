import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Image, Upload, Sparkles, UserCheck, UserPlus, Flag, AlertCircle, AlertTriangle, Share2, Copy, Check, Search, Star } from 'lucide-react';
import { User } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Avatar } from './Avatar';
import { parsePostContent } from '../lib/postMeta';

// ================= EDIT PROFILE MODAL =================
export const EditProfileModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { user, updateProfile, showToast } = useAuth();
  const [displayName, setDisplayName] = useState(user?.display_name || '');
  const [username, setUsername] = useState(user?.username || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [location, setLocation] = useState(user?.location || '');
  const [website, setWebsite] = useState(user?.website || '');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatar_url || '');
  const [bannerUrl, setBannerUrl] = useState(user?.banner_url || '');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, isSubmitting]);

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64 = reader.result as string;
        const res = await api.uploadImage(base64);
        setAvatarUrl(res.url);
      } catch (err) {
        showToast('Avatar upload failed');
      }
    };
    reader.onerror = () => showToast('Could not read avatar file');
    reader.readAsDataURL(file);
  };

  const handleBannerUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64 = reader.result as string;
        const res = await api.uploadImage(base64);
        setBannerUrl(res.url);
      } catch (err) {
        showToast('Banner upload failed');
      }
    };
    reader.onerror = () => showToast('Could not read banner file');
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await updateProfile({
        display_name: displayName,
        username,
        bio,
        location,
        website,
        avatar_url: avatarUrl,
        banner_url: bannerUrl,
      });
      onClose();
    } catch (err: any) {
      showToast(err.message || 'Failed to update profile');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Edit profile"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) onClose();
      }}
      className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-xl flex items-center justify-center p-4 overflow-y-auto"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
        className="glass-surface w-full max-w-lg rounded-3xl p-5 sm:p-6 border border-white/15 relative max-h-[90dvh] overflow-y-auto my-auto"
      >
        <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-4">
          <h3 className="text-base font-semibold text-white">Edit Profile</h3>
          <motion.button
            type="button"
            whileHover={{ scale: 1.1, rotate: 90 }}
            whileTap={{ scale: 0.9 }}
            onClick={onClose}
            aria-label="Close edit profile modal"
            className="w-9 h-9 flex items-center justify-center rounded-full text-zinc-400 hover:text-white hover:bg-white/10 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </motion.button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Banner Upload / Remove */}
          <div>
            <label className="text-xs font-medium text-zinc-300 block mb-1.5">Profile Banner</label>
            <div className="relative h-28 rounded-2xl overflow-hidden border border-white/15 bg-zinc-900">
              {bannerUrl ? (
                <img
                  src={bannerUrl}
                  alt="Banner preview"
                  referrerPolicy="no-referrer"
                  onError={() => setBannerUrl('')}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-zinc-900 via-zinc-950 to-black flex items-center justify-center text-[11px] text-zinc-500">
                  No banner image
                </div>
              )}
              <div className="absolute inset-0 bg-black/35 flex items-center justify-end gap-2 p-2.5 items-end">
                <label className="px-3 py-1.5 rounded-xl glass-pill text-xs text-white hover:bg-white/20 cursor-pointer inline-flex items-center gap-1.5 font-medium">
                  <Upload className="w-3.5 h-3.5" />
                  <span>{bannerUrl ? 'Change Banner' : 'Upload Banner'}</span>
                  <input type="file" accept="image/*" onChange={handleBannerUpload} className="hidden" />
                </label>
                {bannerUrl && (
                  <button
                    type="button"
                    onClick={() => setBannerUrl('')}
                    className="px-3 py-1.5 rounded-xl bg-red-500/20 hover:bg-red-500/35 border border-red-500/35 text-xs text-red-200 font-medium cursor-pointer transition"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Avatar Upload / Remove */}
          <div className="flex items-center gap-4 p-3 rounded-2xl bg-white/[0.03] border border-white/10">
            <div className="relative w-16 h-16 rounded-2xl overflow-hidden border border-white/20 bg-black shrink-0 flex items-center justify-center">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt="Avatar preview"
                  referrerPolicy="no-referrer"
                  onError={() => setAvatarUrl('')}
                  className="w-full h-full object-cover"
                />
              ) : (
                <Avatar name={displayName || user?.display_name || 'User'} size="lg" showPresence={false} />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-zinc-200 mb-1.5">Profile Picture</div>
              <div className="flex items-center gap-2 flex-wrap">
                <label className="px-3 py-1.5 rounded-xl glass-pill text-xs text-white hover:bg-white/15 cursor-pointer inline-flex items-center gap-1.5 font-medium">
                  <Upload className="w-3.5 h-3.5" />
                  <span>{avatarUrl ? 'Change Photo' : 'Upload Photo'}</span>
                  <input type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
                </label>
                {avatarUrl && (
                  <button
                    type="button"
                    onClick={() => setAvatarUrl('')}
                    className="px-3 py-1.5 rounded-xl bg-red-500/15 hover:bg-red-500/30 border border-red-500/30 text-xs text-red-200 font-medium cursor-pointer transition"
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
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="glass-input w-full px-3 py-2 rounded-xl text-xs"
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
                className="glass-input w-full px-3 py-2 rounded-xl text-xs font-mono"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-zinc-300 block mb-1">Bio</label>
            <textarea
              rows={3}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Tell the world about your discipline and aesthetic..."
              className="glass-input w-full px-3 py-2 rounded-xl text-xs resize-none"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-zinc-300 block mb-1">Location</label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="City, Country"
                className="glass-input w-full px-3 py-2 rounded-xl text-xs"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-300 block mb-1">Website</label>
              <input
                type="text"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="https://yourportfolio.com"
                className="glass-input w-full px-3 py-2 rounded-xl text-xs"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-white/10">
            <button type="button" onClick={onClose} className="px-4 py-2 text-xs text-zinc-400 hover:text-white cursor-pointer transition">
              Cancel
            </button>
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              type="submit"
              disabled={isSubmitting}
              className="glass-button-primary px-6 py-2 text-xs font-semibold disabled:opacity-50 cursor-pointer"
            >
              {isSubmitting ? 'Saving...' : 'Save Profile'}
            </motion.button>
          </div>
        </form>
      </motion.div>
    </div>
  );
};

// ================= FOLLOWERS / FOLLOWING MODAL =================
export const FollowersModal: React.FC<{
  username: string;
  type: 'followers' | 'following';
  onClose: () => void;
  onOpenProfile: (username: string) => void;
}> = ({ username, type, onClose, onOpenProfile }) => {
  const [activeType, setActiveType] = useState<'followers' | 'following'>(type);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setActiveType(type);
  }, [username, type]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const fetchList = activeType === 'followers' ? api.getUserFollowers : api.getUserFollowing;
    fetchList(username)
      .then((res) => {
        if (active) setUsers(res.users);
      })
      .catch(() => {
        if (active) setUsers([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [username, activeType]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-xl flex items-center justify-center p-4 overflow-y-auto"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
        className="glass-surface w-full max-w-sm rounded-3xl p-5 sm:p-6 border border-white/15 relative max-h-[88dvh] flex flex-col my-auto"
      >
        <div className="flex items-center justify-between gap-2 pb-3 border-b border-white/10 mb-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-white capitalize truncate">{activeType}</h3>
            <div className="text-[11px] text-zinc-500 font-mono truncate">@{username}</div>
          </div>
          <motion.button
            type="button"
            whileHover={{ scale: 1.1, rotate: 90 }}
            whileTap={{ scale: 0.9 }}
            onClick={onClose}
            aria-label="Close"
            className="w-9 h-9 flex items-center justify-center rounded-full text-zinc-400 hover:text-white hover:bg-white/10 cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </motion.button>
        </div>

        <div className="grid grid-cols-2 gap-1 p-1 rounded-2xl bg-white/[0.04] border border-white/10 mb-3 shrink-0">
          {(['followers', 'following'] as const).map((tabType) => {
            const isActive = activeType === tabType;
            return (
              <button
                key={tabType}
                type="button"
                onClick={() => setActiveType(tabType)}
                className={`py-1.5 rounded-xl text-xs font-semibold capitalize transition cursor-pointer ${
                  isActive
                    ? 'bg-white text-black shadow-sm'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                {tabType}
              </button>
            );
          })}
        </div>

        <div className="max-h-80 overflow-y-auto flex flex-col gap-2">
          {loading ? (
            <div className="py-8 text-center text-xs text-zinc-500 font-mono">Loading...</div>
          ) : users.length === 0 ? (
            <div className="py-8 text-center text-xs text-zinc-500">No {activeType} yet.</div>
          ) : (
            users.map((u) => (
              <div
                key={u.id}
                onClick={() => {
                  onOpenProfile(u.username);
                  onClose();
                }}
                className="flex items-center justify-between p-2.5 rounded-2xl hover:bg-white/10 cursor-pointer transition"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar
                    userId={u.id}
                    name={u.display_name}
                    url={u.avatar_url}
                    size="sm"
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-white flex items-center gap-1 truncate">
                      <span className="truncate">{u.display_name}</span>
                      {u.is_verified ? <Sparkles className="w-3 h-3 text-zinc-300 shrink-0" /> : null}
                    </div>
                    <div className="text-[10px] text-zinc-500 font-mono truncate">@{u.username}</div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </motion.div>
    </div>
  );
};

// ================= LIKED BY MODAL =================
export const LikedByModal: React.FC<{
  postId: string;
  onClose: () => void;
  onOpenProfile: (username: string) => void;
}> = ({ postId, onClose, onOpenProfile }) => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    api.getPostLikes(postId)
      .then((res) => setUsers(res.users))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [postId]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Liked by"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-xl flex items-center justify-center p-4 overflow-y-auto"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
        className="glass-surface w-full max-w-sm rounded-3xl p-5 sm:p-6 border border-white/15 relative max-h-[88dvh] overflow-y-auto my-auto"
      >
        <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-4">
          <h3 className="text-sm font-semibold text-white">Liked By</h3>
          <motion.button
            type="button"
            whileHover={{ scale: 1.1, rotate: 90 }}
            whileTap={{ scale: 0.9 }}
            onClick={onClose}
            aria-label="Close liked by dialog"
            className="w-9 h-9 flex items-center justify-center rounded-full text-zinc-400 hover:text-white hover:bg-white/10 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </motion.button>
        </div>

        <div className="max-h-80 overflow-y-auto flex flex-col gap-2">
          {loading ? (
            <div className="py-8 text-center text-xs text-zinc-500 font-mono">Loading...</div>
          ) : users.length === 0 ? (
            <div className="py-8 text-center text-xs text-zinc-500">No likes yet.</div>
          ) : (
            users.map((u) => (
              <motion.div
                key={u.id}
                whileHover={{ x: 3, backgroundColor: 'rgba(255, 255, 255, 0.08)' }}
                onClick={() => {
                  onOpenProfile(u.username);
                  onClose();
                }}
                className="flex items-center justify-between p-2.5 rounded-2xl cursor-pointer transition"
              >
                <div className="flex items-center gap-3">
                  <Avatar
                    userId={u.id}
                    name={u.display_name}
                    url={u.avatar_url}
                    size="sm"
                  />
                  <div>
                    <div className="text-xs font-semibold text-white flex items-center gap-1">
                      {u.display_name}
                      {u.is_verified ? <Sparkles className="w-3 h-3 text-zinc-300" /> : null}
                    </div>
                    <div className="text-[10px] text-zinc-500 font-mono">@{u.username}</div>
                  </div>
                </div>
              </motion.div>
            ))
          )}
        </div>
      </motion.div>
    </div>
  );
};

// ================= REPORT MODAL =================
export const ReportModal: React.FC<{
  targetId: string;
  targetType?: 'post' | 'user' | 'comment';
  onClose: () => void;
}> = ({ targetId, targetType = 'post', onClose }) => {
  const { showToast, brandName } = useAuth();
  const currentBrand = brandName || 'SYNC';
  const [reason, setReason] = useState('Inappropriate content');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reasons = [
    'Inappropriate content',
    'Spam or bot activity',
    'Harassment or hate speech',
    'Intellectual property / copyright',
    'Deceptive or false information',
  ];

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, submitting]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.report({
        target_type: targetType,
        target_id: targetId,
        reason,
        details,
      });
      showToast(`Thank you. The report has been sent to ${currentBrand} moderation.`);
      onClose();
    } catch (e: any) {
      showToast('Report submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Report content"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
      className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-xl flex items-center justify-center p-4 overflow-y-auto"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
        className="glass-surface w-full max-w-md rounded-3xl p-5 sm:p-6 border border-white/15 relative max-h-[90dvh] overflow-y-auto my-auto"
      >
        <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-4">
          <div className="flex items-center gap-2 text-red-400">
            <AlertCircle className="w-4 h-4" />
            <h3 className="text-sm font-semibold text-white">Report Content</h3>
          </div>
          <motion.button
            type="button"
            whileHover={{ scale: 1.1, rotate: 90 }}
            whileTap={{ scale: 0.9 }}
            onClick={onClose}
            aria-label="Close report dialog"
            className="w-9 h-9 flex items-center justify-center rounded-full text-zinc-400 hover:text-white hover:bg-white/10 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </motion.button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="text-xs font-medium text-zinc-300 block mb-2">Reason</label>
            <div className="flex flex-col gap-1.5">
              {reasons.map((r) => (
                <label
                  key={r}
                  className={`flex items-center gap-3 p-2.5 rounded-xl border text-xs cursor-pointer transition ${
                    reason === r ? 'bg-white/10 border-white/30 text-white' : 'border-white/5 text-zinc-400 hover:bg-white/5'
                  }`}
                >
                  <input
                    type="radio"
                    name="report_reason"
                    value={r}
                    checked={reason === r}
                    onChange={(e) => setReason(e.target.value)}
                    className="accent-white"
                  />
                  <span>{r}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-zinc-300 block mb-1">Additional Context (Optional)</label>
            <textarea
              rows={2}
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="Help us understand the issue..."
              className="glass-input w-full px-3 py-2 rounded-xl text-xs resize-none"
            />
          </div>

          <div className="flex justify-end gap-3 pt-3 border-t border-white/10">
            <button type="button" onClick={onClose} className="px-4 py-2 text-xs text-zinc-400 hover:text-white cursor-pointer transition">
              Cancel
            </button>
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              type="submit"
              disabled={submitting}
              className="px-5 py-2 rounded-2xl bg-red-500/20 text-red-300 border border-red-500/30 text-xs font-semibold hover:bg-red-500/30 transition disabled:opacity-50 cursor-pointer"
            >
              {submitting ? 'Submitting...' : 'Submit Report'}
            </motion.button>
          </div>
        </form>
      </motion.div>
    </div>
  );
};

// ================= INVITE & CONNECT MODAL =================
export const InviteModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { user, showToast, brandName } = useAuth();
  const currentBrand = brandName || 'SYNC';
  const [copied, setCopied] = useState(false);

  const inviteUrl = user
    ? `${window.location.origin}/?u=${user.username}`
    : `${window.location.origin}/`;

  const handleCopy = () => {
    navigator.clipboard?.writeText(inviteUrl);
    setCopied(true);
    showToast('Direct link copied to clipboard');
    setTimeout(() => setCopied(false), 3000);
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${currentBrand} — A Social Space Without The Noise`,
          text: user
            ? `Connect with me on ${currentBrand}: @${user.username}`
            : `Join ${currentBrand} — A social space for real people without the noise.`,
          url: inviteUrl,
        });
      } catch (err) {}
    } else {
      handleCopy();
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Invite and connect"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-xl flex items-center justify-center p-4 overflow-y-auto"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
        className="glass-surface w-full max-w-md rounded-3xl p-5 sm:p-8 border border-white/15 relative shadow-2xl max-h-[90dvh] overflow-y-auto my-auto"
      >
        <motion.button
          type="button"
          whileHover={{ scale: 1.1, rotate: 90 }}
          whileTap={{ scale: 0.9 }}
          onClick={onClose}
          aria-label="Close invite dialog"
          className="w-9 h-9 flex items-center justify-center absolute top-4 right-4 rounded-full text-zinc-400 hover:text-white hover:bg-white/10 cursor-pointer"
        >
          <X className="w-5 h-5" />
        </motion.button>

        <div className="text-center mb-6">
          <motion.div
            whileHover={{ scale: 1.08 }}
            className="w-12 h-12 rounded-2xl bg-white/10 text-white flex items-center justify-center mx-auto mb-3 shadow-[0_0_20px_rgba(255,255,255,0.1)]"
          >
            <UserPlus className="w-6 h-6" />
          </motion.div>
          <h3 className="text-lg font-bold text-white">Connect with Real People</h3>
          <p className="text-xs text-zinc-400 mt-1 max-w-sm mx-auto leading-relaxed">
            {currentBrand} is built for real human connection. Share your direct link with friends or colleagues so they can find your profile, follow you, and message you in real-time.
          </p>
        </div>

        <div className="flex flex-col gap-3 mb-6">
          <label className="text-xs font-medium text-zinc-300">
            {user ? 'Your Personal Profile Link' : `${currentBrand} Platform Link`}
          </label>
          <div className="flex items-center gap-2 p-1.5 rounded-2xl glass-input">
            <input
              type="text"
              readOnly
              value={inviteUrl}
              className="bg-transparent text-xs text-zinc-300 px-3 py-1 flex-1 outline-none font-mono truncate"
            />
            <motion.button
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleCopy}
              className="glass-button-primary px-4 py-2 text-xs font-semibold shrink-0 cursor-pointer"
            >
              {copied ? 'Copied!' : 'Copy Link'}
            </motion.button>
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          <label className="text-xs font-medium text-zinc-400">Share with Friends Directly</label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <a
              href={`https://api.whatsapp.com/send?text=${encodeURIComponent((user ? `Connect with me on ${currentBrand}: @${user.username}\n` : `Join me on ${currentBrand} — a real social space without noise:\n`) + inviteUrl)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="py-2.5 px-3 rounded-xl bg-white/[0.05] hover:bg-emerald-500/20 text-emerald-400 border border-white/10 text-xs font-semibold text-center transition flex items-center justify-center gap-1.5"
            >
              <span>WhatsApp</span>
            </a>
            <a
              href={`https://t.me/share/url?url=${encodeURIComponent(inviteUrl)}&text=${encodeURIComponent(user ? `Connect with me on ${currentBrand}: @${user.username}` : `Join me on ${currentBrand} — real social space without noise`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="py-2.5 px-3 rounded-xl bg-white/[0.05] hover:bg-sky-500/20 text-sky-400 border border-white/10 text-xs font-semibold text-center transition flex items-center justify-center gap-1.5"
            >
              <span>Telegram</span>
            </a>
            <a
              href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(user ? `Connect with me on ${currentBrand}: @${user.username}` : `A real social space without noise: `)}&url=${encodeURIComponent(inviteUrl)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="py-2.5 px-3 rounded-xl bg-white/[0.05] hover:bg-white/15 text-white border border-white/10 text-xs font-semibold text-center transition flex items-center justify-center gap-1.5"
            >
              <span>X (Twitter)</span>
            </a>
            <a
              href={`mailto:?subject=${encodeURIComponent(`Join me on ${currentBrand}`)}&body=${encodeURIComponent((user ? `Connect with me on ${currentBrand}: @${user.username}\n` : `Join me on ${currentBrand} — real social space without noise:\n`) + inviteUrl)}`}
              className="py-2.5 px-3 rounded-xl bg-white/[0.05] hover:bg-white/15 text-zinc-300 border border-white/10 text-xs font-semibold text-center transition flex items-center justify-center gap-1.5"
            >
              <span>Email / SMS</span>
            </a>
          </div>

          {typeof navigator !== 'undefined' && 'share' in navigator && (
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleNativeShare}
              className="w-full mt-2 py-3 rounded-2xl bg-white/10 hover:bg-white/15 text-white text-xs font-semibold transition cursor-pointer"
            >
              Share via Phone Apps
            </motion.button>
          )}
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-2xl text-xs text-zinc-400 hover:text-white transition cursor-pointer"
          >
            Close
          </button>
        </div>
      </motion.div>
    </div>
  );
};

// ================= SIMPLE REUSABLE WARNING POP-UP =================
export interface WarningPopupProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'warning' | 'danger';
  loading?: boolean;
  loadingLabel?: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export const WarningPopup: React.FC<WarningPopupProps> = ({
  open,
  title,
  message,
  confirmLabel = 'Continue',
  cancelLabel = 'Cancel',
  tone = 'warning',
  loading = false,
  loadingLabel,
  onConfirm,
  onCancel,
}) => {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) {
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [open, loading, onCancel]);

  if (typeof document === 'undefined') return null;

  const isDanger = tone === 'danger';

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="warning-popup-title"
          aria-describedby="warning-popup-desc"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            if (e.target === e.currentTarget && !loading) {
              onCancel();
            }
          }}
          className="fixed inset-0 z-[130] bg-black/80 backdrop-blur-xl flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className={`glass-surface w-full max-w-sm rounded-3xl p-5 sm:p-6 border relative shadow-2xl ${
              isDanger ? 'border-red-500/25' : 'border-amber-500/25'
            }`}
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className={`w-9 h-9 rounded-2xl flex items-center justify-center shrink-0 border ${
                    isDanger
                      ? 'bg-red-500/15 border-red-500/30 text-red-400'
                      : 'bg-amber-500/15 border-amber-500/30 text-amber-400'
                  }`}
                >
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <h3
                  id="warning-popup-title"
                  className="text-sm font-semibold text-white leading-snug"
                >
                  {title}
                </h3>
              </div>
              <button
                type="button"
                onClick={onCancel}
                disabled={loading}
                aria-label="Close warning"
                className="w-9 h-9 -mt-1 -mr-1 flex items-center justify-center rounded-full text-zinc-400 hover:text-white hover:bg-white/10 transition cursor-pointer shrink-0 disabled:opacity-40"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p
              id="warning-popup-desc"
              className="text-xs text-zinc-300 leading-relaxed mb-5"
            >
              {message}
            </p>

            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={onCancel}
                disabled={loading}
                className="px-4 min-h-[40px] rounded-xl text-xs font-medium text-zinc-300 hover:text-white hover:bg-white/5 transition cursor-pointer disabled:opacity-40"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={loading}
                className={`px-5 min-h-[40px] rounded-2xl border text-xs font-semibold transition disabled:opacity-50 cursor-pointer ${
                  isDanger
                    ? 'bg-red-500/20 text-red-300 border-red-500/35 hover:bg-red-500/30'
                    : 'bg-amber-500/20 text-amber-200 border-amber-500/35 hover:bg-amber-500/30'
                }`}
              >
                {loading ? loadingLabel || 'Working...' : confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};

// ================= SIGN OUT CONFIRMATION WARNING MODAL =================
export const SignOutConfirmModal: React.FC = () => {
  const {
    user,
    signOutConfirmOpen,
    cancelLogout,
    confirmLogout,
  } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  if (!user) return null;

  const handleConfirm = async () => {
    setSigningOut(true);
    try {
      await confirmLogout();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <WarningPopup
      open={signOutConfirmOpen}
      title={`Sign out of @${user.username}?`}
      message="You will need to sign back in to post, react, or send messages. Everything stays saved in the cloud."
      confirmLabel="Sign Out"
      cancelLabel="Cancel"
      tone="warning"
      loading={signingOut}
      loadingLabel="Signing out..."
      onConfirm={handleConfirm}
      onCancel={cancelLogout}
    />
  );
};

// ================= SHARE POST MODAL =================
export const SharePostModal: React.FC<{
  post: {
    id: string;
    user_id?: string;
    username: string;
    display_name: string;
    avatar_url?: string;
    content: string;
    images?: string[];
  };
  onClose: () => void;
}> = ({ post, onClose }) => {
  const { user, showToast, brandName } = useAuth();
  const currentBrand = brandName || 'SYNC';
  const [copied, setCopied] = useState(false);
  const [conversations, setConversations] = useState<Array<{
    id: string;
    other_id: string;
    username: string;
    display_name: string;
    avatar_url?: string;
  }>>([]);
  const [sentRecipientIds, setSentRecipientIds] = useState<Record<string, boolean>>({});
  const [sendingRecipientId, setSendingRecipientId] = useState<string | null>(null);
  const [suggestedUsers, setSuggestedUsers] = useState<User[]>([]);
  const [recipientSearch, setRecipientSearch] = useState('');
  const [previewImgFailed, setPreviewImgFailed] = useState(false);

  const postUrl = `${window.location.origin}/?post=${encodeURIComponent(post.id)}`;
  const { cleanText: cleanPostContent } = parsePostContent(post.content);
  const previewText = cleanPostContent
    ? cleanPostContent.slice(0, 140)
    : `Post by @${post.username} on ${currentBrand}`;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    Promise.allSettled([api.getConversations(), api.getSuggestedUsers()]).then(([convRes, sugRes]) => {
      if (!active) return;
      if (convRes.status === 'fulfilled') {
        setConversations(convRes.value.conversations || []);
      }
      if (sugRes.status === 'fulfilled') {
        setSuggestedUsers((sugRes.value.users || []).filter((u) => u.id !== user.id));
      }
    });
    return () => {
      active = false;
    };
  }, [user]);

  const shareRecipients = React.useMemo(() => {
    const map = new Map<
      string,
      { otherId: string; convId?: string; username: string; display_name: string; avatar_url?: string }
    >();
    conversations.forEach((c) => {
      if (c.other_id && c.other_id !== user?.id) {
        map.set(c.other_id, {
          otherId: c.other_id,
          convId: c.id,
          username: c.username,
          display_name: c.display_name,
          avatar_url: c.avatar_url,
        });
      }
    });
    suggestedUsers.forEach((u) => {
      if (u.id && u.id !== user?.id && !map.has(u.id)) {
        map.set(u.id, {
          otherId: u.id,
          username: u.username,
          display_name: u.display_name,
          avatar_url: u.avatar_url,
        });
      }
    });
    const q = recipientSearch.trim().toLowerCase();
    const list = Array.from(map.values());
    if (!q) return list.slice(0, 12);
    return list.filter(
      (r) =>
        r.username.toLowerCase().includes(q) ||
        r.display_name.toLowerCase().includes(q)
    );
  }, [conversations, suggestedUsers, recipientSearch, user?.id]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard?.writeText(postUrl);
      setCopied(true);
      showToast('Post link copied to clipboard');
      setTimeout(() => setCopied(false), 2500);
    } catch {
      showToast('Select the link above to copy');
    }
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${post.display_name} (@${post.username}) on ${currentBrand}`,
          text: previewText,
          url: postUrl,
        });
      } catch {}
    } else {
      handleCopy();
    }
  };

  const handleSendInChat = async (recipient: {
    otherId: string;
    convId?: string;
    username: string;
  }) => {
    if (sendingRecipientId || sentRecipientIds[recipient.otherId]) return;
    setSendingRecipientId(recipient.otherId);
    try {
      const convId =
        recipient.convId || (await api.createConversation(recipient.otherId)).conversationId;
      await api.sendMessage(convId, '', null, recipient.otherId, {
        sharedPost: {
          id: post.id,
          username: post.username,
          display_name: post.display_name,
          content: cleanPostContent,
          images: post.images,
        },
      });
      setSentRecipientIds((prev) => ({ ...prev, [recipient.otherId]: true }));
      showToast(`Shared post with @${recipient.username}`);
    } catch {
      showToast('Could not send post');
    } finally {
      setSendingRecipientId(null);
    }
  };

  const modalContent = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-post-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-xl flex items-center justify-center p-4"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        className="glass-surface w-full max-w-md rounded-3xl p-5 sm:p-6 border border-white/15 relative shadow-2xl max-h-[90dvh] overflow-y-auto"
      >
        <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center text-white">
              <Share2 className="w-4 h-4" />
            </div>
            <div>
              <h3 id="share-post-title" className="text-sm font-semibold text-white">
                Share Post
              </h3>
              <p className="text-[11px] text-zinc-400">
                Send in Messages or copy direct post link
              </p>
            </div>
          </div>
          <motion.button
            type="button"
            whileHover={{ scale: 1.1, rotate: 90 }}
            whileTap={{ scale: 0.9 }}
            onClick={onClose}
            aria-label="Close share dialog"
            className="w-9 h-9 flex items-center justify-center rounded-full text-zinc-400 hover:text-white hover:bg-white/10 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </motion.button>
        </div>

        {/* Post Preview Card */}
        <div className="p-3.5 rounded-2xl bg-white/[0.04] border border-white/10 mb-4 flex items-start gap-3">
          <Avatar
            userId={post.user_id}
            name={post.display_name}
            url={post.avatar_url}
            size="sm"
            className="shrink-0"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-xs">
              <span className="font-semibold text-white truncate">{post.display_name}</span>
              <span className="text-zinc-500 font-mono truncate">@{post.username}</span>
            </div>
            <p className="text-xs text-zinc-300 mt-1 line-clamp-2 leading-relaxed">
              {cleanPostContent || 'Shared media post'}
            </p>
          </div>
          {post.images && post.images.length > 0 && !previewImgFailed && (
            <img
              src={post.images[0]}
              alt="Post preview"
              referrerPolicy="no-referrer"
              onError={() => setPreviewImgFailed(true)}
              className="w-12 h-12 rounded-xl object-cover border border-white/10 shrink-0"
            />
          )}
        </div>

        {/* Quick Send in SYNC Messages */}
        {user && (conversations.length > 0 || suggestedUsers.length > 0) && (
          <div className="flex flex-col gap-2.5 mb-5">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-medium text-zinc-300">
                Send in {currentBrand} Messages
              </label>
            </div>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={recipientSearch}
                onChange={(e) => setRecipientSearch(e.target.value)}
                placeholder="Search member to send..."
                className="glass-input w-full pl-8 pr-3 py-2 rounded-xl text-xs"
              />
            </div>
            {shareRecipients.length === 0 ? (
              <p className="text-[11px] text-zinc-500 py-2 text-center">No matching members found.</p>
            ) : (
              <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                {shareRecipients.map((rec) => {
                  const isSent = !!sentRecipientIds[rec.otherId];
                  const isSending = sendingRecipientId === rec.otherId;
                  return (
                    <button
                      key={rec.otherId}
                      type="button"
                      disabled={isSent || isSending}
                      onClick={() => handleSendInChat(rec)}
                      className={`flex flex-col items-center gap-1.5 p-2 rounded-2xl border min-w-[74px] max-w-[82px] transition cursor-pointer shrink-0 ${
                        isSent
                          ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                          : 'bg-white/[0.04] hover:bg-white/[0.1] border-white/10 text-zinc-300 hover:text-white'
                      }`}
                    >
                      <Avatar
                        userId={rec.otherId}
                        name={rec.display_name}
                        url={rec.avatar_url}
                        size="sm"
                      />
                      <span className="text-[10px] font-medium truncate w-full text-center">
                        {isSent ? 'Sent' : isSending ? '...' : rec.display_name.split(' ')[0]}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Visible Post Link Section */}
        <div className="flex flex-col gap-2 mb-5">
          <label className="text-xs font-medium text-zinc-300">
            Post Link
          </label>
          <div className="flex items-center gap-2 p-1.5 rounded-2xl glass-input border border-white/15">
            <input
              type="text"
              readOnly
              value={postUrl}
              onClick={(e) => e.currentTarget.select()}
              aria-label="Shareable post URL"
              className="bg-transparent text-xs text-zinc-200 px-2.5 py-1.5 flex-1 min-w-0 outline-none font-mono select-all"
            />
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.96 }}
              type="button"
              onClick={handleCopy}
              className="glass-button-primary px-3.5 py-2 text-xs font-semibold shrink-0 cursor-pointer flex items-center gap-1.5"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied!' : 'Copy'}</span>
            </motion.button>
          </div>
        </div>

        {/* External Share Apps */}
        <div className="flex flex-col gap-2.5">
          <label className="text-xs font-medium text-zinc-400">Share Anywhere</label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <a
              href={`https://api.whatsapp.com/send?text=${encodeURIComponent(`${previewText}\n${postUrl}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="py-2.5 px-3 rounded-xl bg-white/[0.05] hover:bg-emerald-500/20 text-emerald-400 border border-white/10 text-xs font-semibold text-center transition flex items-center justify-center"
            >
              WhatsApp
            </a>
            <a
              href={`https://t.me/share/url?url=${encodeURIComponent(postUrl)}&text=${encodeURIComponent(previewText)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="py-2.5 px-3 rounded-xl bg-white/[0.05] hover:bg-sky-500/20 text-sky-400 border border-white/10 text-xs font-semibold text-center transition flex items-center justify-center"
            >
              Telegram
            </a>
            <a
              href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(previewText)}&url=${encodeURIComponent(postUrl)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="py-2.5 px-3 rounded-xl bg-white/[0.05] hover:bg-white/15 text-white border border-white/10 text-xs font-semibold text-center transition flex items-center justify-center"
            >
              X (Twitter)
            </a>
            <a
              href={`mailto:?subject=${encodeURIComponent(`Post by @${post.username} on ${currentBrand}`)}&body=${encodeURIComponent(`${previewText}\n\n${postUrl}`)}`}
              className="py-2.5 px-3 rounded-xl bg-white/[0.05] hover:bg-white/15 text-zinc-300 border border-white/10 text-xs font-semibold text-center transition flex items-center justify-center"
            >
              Email / SMS
            </a>
          </div>

          {typeof navigator !== 'undefined' && 'share' in navigator && (
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              type="button"
              onClick={handleNativeShare}
              className="w-full mt-1 py-2.5 rounded-2xl bg-white/10 hover:bg-white/15 text-white text-xs font-semibold transition cursor-pointer"
            >
              Share via Device Apps
            </motion.button>
          )}
        </div>
      </motion.div>
    </div>
  );

  if (typeof document === 'undefined') return modalContent;
  return createPortal(modalContent, document.body);
};

// ================= CLOSE FRIENDS MODAL =================
export const CloseFriendsModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { user, showToast } = useAuth();
  const [closeFriendIds, setCloseFriendIds] = useState<string[]>([]);
  const [candidates, setCandidates] = useState<User[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    let active = true;
    const loadData = async () => {
      setLoading(true);
      try {
        const [cfRes, followingRes, suggestedRes] = await Promise.allSettled([
          api.getCloseFriends(),
          user?.username ? api.getUserFollowing(user.username) : Promise.resolve({ users: [] }),
          api.getSuggestedUsers(),
        ]);

        if (!active) return;

        const map = new Map<string, User>();
        if (cfRes.status === 'fulfilled') {
          setCloseFriendIds(cfRes.value.ids);
          cfRes.value.users.forEach((u) => {
            if (u.id !== user?.id) map.set(u.id, u);
          });
        }
        if (followingRes.status === 'fulfilled') {
          followingRes.value.users.forEach((u) => {
            if (u.id !== user?.id && !map.has(u.id)) map.set(u.id, u);
          });
        }
        if (suggestedRes.status === 'fulfilled') {
          suggestedRes.value.users.forEach((u) => {
            if (u.id !== user?.id && !map.has(u.id)) map.set(u.id, u);
          });
        }
        setCandidates(Array.from(map.values()));
      } catch {
        // Ignore
      } finally {
        if (active) setLoading(false);
      }
    };
    loadData();
    return () => {
      active = false;
    };
  }, [user?.id, user?.username]);

  const handleToggle = async (target: User) => {
    if (pendingId) return;
    const isAdded = closeFriendIds.includes(target.id);
    setPendingId(target.id);
    // Optimistic update
    setCloseFriendIds((prev) =>
      isAdded ? prev.filter((id) => id !== target.id) : [...prev, target.id]
    );
    try {
      if (isAdded) {
        await api.removeCloseFriend(target.id);
        showToast(`Removed @${target.username} from Close Friends`);
      } else {
        await api.addCloseFriend(target.id);
        showToast(`Added @${target.username} to Close Friends`);
      }
    } catch {
      setCloseFriendIds((prev) =>
        isAdded ? [...prev, target.id] : prev.filter((id) => id !== target.id)
      );
      showToast('Could not update Close Friends');
    } finally {
      setPendingId(null);
    }
  };

  const filteredCandidates = candidates
    .filter((u) => {
      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      return (
        u.username.toLowerCase().includes(q) ||
        u.display_name.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      const aCf = closeFriendIds.includes(a.id) ? 0 : 1;
      const bCf = closeFriendIds.includes(b.id) ? 0 : 1;
      return aCf - bCf;
    });

  const modalContent = (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[120] bg-black/85 backdrop-blur-xl flex items-center justify-center p-4"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        className="glass-surface w-full max-w-md rounded-3xl p-5 sm:p-6 border border-white/15 relative shadow-2xl max-h-[85dvh] flex flex-col"
      >
        <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-400/35 flex items-center justify-center text-emerald-400">
              <Star className="w-4 h-4 fill-emerald-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">Close Friends</h3>
              <p className="text-[11px] text-zinc-400 tabular-nums">
                {closeFriendIds.length} {closeFriendIds.length === 1 ? 'person' : 'people'} selected
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close close friends dialog"
            className="w-9 h-9 flex items-center justify-center rounded-full text-zinc-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-[11px] text-zinc-400 mb-3 leading-relaxed">
          People on your list will see stories you share exclusively with Close Friends (shown with an emerald ring).
        </p>

        <div className="relative mb-3">
          <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search people..."
            className="glass-input w-full pl-9 pr-3 py-2.5 rounded-xl text-xs"
          />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
          {loading ? (
            <div className="py-8 text-center text-xs text-zinc-500">Loading connections...</div>
          ) : filteredCandidates.length === 0 ? (
            <div className="py-8 text-center text-xs text-zinc-500">No members found.</div>
          ) : (
            filteredCandidates.map((member) => {
              const isSelected = closeFriendIds.includes(member.id);
              return (
                <div
                  key={member.id}
                  className="flex items-center justify-between gap-3 p-2.5 rounded-2xl bg-white/[0.03] border border-white/5"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar
                      userId={member.id}
                      name={member.display_name}
                      url={member.avatar_url}
                      size="sm"
                    />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-white truncate flex items-center gap-1">
                        <span className="truncate">{member.display_name}</span>
                        {member.is_verified ? <Sparkles className="w-3 h-3 text-zinc-300 shrink-0" /> : null}
                      </div>
                      <div className="text-[10px] text-zinc-500 font-mono truncate">@{member.username}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={pendingId === member.id}
                    onClick={() => handleToggle(member)}
                    className={`min-h-[36px] px-3.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shrink-0 ${
                      isSelected
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 hover:bg-emerald-500/30'
                        : 'bg-white/10 text-zinc-200 border border-white/10 hover:bg-white/15'
                    }`}
                  >
                    <Star className={`w-3.5 h-3.5 ${isSelected ? 'fill-emerald-400 text-emerald-400' : ''}`} />
                    <span>{isSelected ? 'Added' : 'Add'}</span>
                  </button>
                </div>
              );
            })
          )}
        </div>
      </motion.div>
    </div>
  );

  if (typeof document === 'undefined') return modalContent;
  return createPortal(modalContent, document.body);
};
