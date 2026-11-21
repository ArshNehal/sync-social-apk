import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  MapPin,
  Link as LinkIcon,
  Calendar,
  Sparkles,
  Lock,
  UserCheck,
  UserPlus,
  Clock,
  Edit3,
  ArrowLeft,
  Grid,
  Heart,
  Ban,
  MessageCircle,
  Share2,
  Bookmark,
  Settings,
  Bell,
  X,
  Layers,
  MessageSquare,
  Star,
  Plus,
  AtSign,
  Pin,
  Upload,
  ArrowLeftRight,
} from 'lucide-react';
import { User, Post, Story, StoryHighlight } from '../types';
import { motion } from 'motion/react';
import { api } from '../lib/api';
import { soundFX } from '../lib/sounds';
import { auth } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import { PostCard } from './PostCard';
import { Avatar } from './Avatar';
import { StoryViewerModal } from './StoriesBar';
import { SpLevelProgressBar } from './SpLevelProgressBar';
import { WarningPopup } from './Modals';

interface UserProfileViewProps {
  username: string;
  onBack?: () => void;
  onOpenProfile?: (username: string) => void;
  onOpenEditProfile: () => void;
  onOpenLikedBy: (postId: string) => void;
  onOpenReport: (postId: string) => void;
  onOpenFollowers: (username: string) => void;
  onOpenFollowing: (username: string) => void;
  onOpenChat?: (userId: string) => void;
  onShareProfile?: (username: string) => void;
  onOpenAlerts?: () => void;
  unreadAlertsCount?: number;
  onOpenSaved?: () => void;
  onOpenSettings?: () => void;
  onOpenLeaderboard?: () => void;
  onQuotePost?: (post: Post) => void;
  onRepostCreated?: (post: Post) => void;
  onOpenPost?: (post: Post) => void;
}

export const UserProfileView: React.FC<UserProfileViewProps> = ({
  username,
  onBack,
  onOpenProfile,
  onOpenEditProfile,
  onOpenLikedBy,
  onOpenReport,
  onOpenFollowers,
  onOpenFollowing,
  onOpenChat,
  onShareProfile,
  onOpenAlerts,
  unreadAlertsCount = 0,
  onOpenSaved,
  onOpenSettings,
  onOpenLeaderboard,
  onQuotePost,
  onRepostCreated,
  onOpenPost,
}) => {
  const { user: currentUser, authConfirmedUid, openAuth, openAccountSwitcher, showToast } = useAuth();
  const [profile, setProfile] = useState<User | null>(() => api.getCachedProfile(username));
  const [posts, setPosts] = useState<Post[]>(() => api.getCachedUserPosts(username) || []);
  const [likedPosts, setLikedPosts] = useState<Post[]>(() => api.getCachedUserLikes(username) || []);
  const [taggedPosts, setTaggedPosts] = useState<Post[]>([]);
  const [taggedStories, setTaggedStories] = useState<
    Array<{ story: Story; authorUsername: string; authorDisplayName: string; authorAvatar: string }>
  >([]);
  const [highlights, setHighlights] = useState<StoryHighlight[]>([]);
  const [activeHighlightViewer, setActiveHighlightViewer] = useState<{
    highlight: StoryHighlight;
    index: number;
  } | null>(null);
  const [newHighlightModalOpen, setNewHighlightModalOpen] = useState(false);
  const [newHltTitle, setNewHltTitle] = useState('');
  const [newHltImage, setNewHltImage] = useState('');
  const [newHltCaption, setNewHltCaption] = useState('');
  const [creatingHighlight, setCreatingHighlight] = useState(false);
  const [isCloseFriend, setIsCloseFriend] = useState(false);
  const [closeFriendLoading, setCloseFriendLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'posts' | 'grid' | 'likes' | 'tagged'>('posts');
  const [loading, setLoading] = useState<boolean>(() => !api.getCachedProfile(username));
  const [followLoading, setFollowLoading] = useState(false);
  const [blockConfirmOpen, setBlockConfirmOpen] = useState(false);
  const [blockingUser, setBlockingUser] = useState(false);
  const [isProfileOnline, setIsProfileOnline] = useState(false);
  const [bannerFailed, setBannerFailed] = useState(false);
  const [failedGridIds, setFailedGridIds] = useState<Record<string, boolean>>({});

  const isMe = currentUser && currentUser.username.toLowerCase() === username.toLowerCase();
  const showOnlineDot = Boolean(isMe || isProfileOnline);

  const sortedProfilePosts = React.useMemo(() => {
    return [...posts].sort((a, b) => {
      if (!!a.is_pinned !== !!b.is_pinned) return a.is_pinned ? -1 : 1;
      if (a.is_pinned && b.is_pinned) {
        return new Date(b.pinned_at || b.created_at).getTime() - new Date(a.pinned_at || a.created_at).getTime();
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [posts]);

  const loadProfile = async () => {
    const cachedProf = api.getCachedProfile(username);
    const cachedPosts = api.getCachedUserPosts(username);
    const cachedLikes = api.getCachedUserLikes(username);
    if (cachedProf) {
      setProfile(cachedProf);
      if (cachedPosts) setPosts(cachedPosts);
      if (cachedLikes) setLikedPosts(cachedLikes);
      setLoading(false);
    } else {
      setLoading(true);
    }

    try {
      if (typeof (auth as any).authStateReady === 'function') {
        await (auth as any).authStateReady();
      }
      const [profileRes, postsRes, likesRes, taggedRes] = await Promise.allSettled([
        api.getProfile(username),
        api.getUserPosts(username),
        api.getUserLikes(username),
        api.getUserTaggedContent(username),
      ]);

      let loadedUserId: string | undefined = cachedProf?.id;
      if (profileRes.status === 'fulfilled') {
        setProfile(profileRes.value.user);
        loadedUserId = profileRes.value.user.id;
      } else if (!cachedProf) {
        throw profileRes.reason;
      }

      if (postsRes.status === 'fulfilled') {
        setPosts(postsRes.value.posts);
      } else if (!cachedPosts) {
        setPosts([]);
      }

      if (likesRes.status === 'fulfilled') {
        setLikedPosts(likesRes.value.posts);
      } else if (!cachedLikes) {
        setLikedPosts([]);
      }

      if (taggedRes.status === 'fulfilled') {
        setTaggedPosts(taggedRes.value.posts);
        setTaggedStories(taggedRes.value.stories);
      }

      if (loadedUserId) {
        api.getUserHighlights(loadedUserId)
          .then((res) => setHighlights(res.highlights))
          .catch(() => {});
        if (currentUser && loadedUserId !== currentUser.id) {
          api.isUserCloseFriend(loadedUserId)
            .then((val) => setIsCloseFriend(val))
            .catch(() => {});
        } else {
          setIsCloseFriend(false);
        }
      }
    } catch (err: any) {
      if (!cachedProf) {
        showToast(err?.message || 'Error loading profile');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setBannerFailed(false);
    setFailedGridIds({});
    loadProfile();
  }, [username, authConfirmedUid]);

  useEffect(() => {
    setBannerFailed(false);
  }, [profile?.banner_url]);

  useEffect(() => {
    if (!newHighlightModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !creatingHighlight) {
        setNewHighlightModalOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [newHighlightModalOpen, creatingHighlight]);

  // Synchronously reflect live profile / PFP / banner updates on current profile & posts
  useEffect(() => {
    if (!currentUser) return;
    if (isMe || (profile && profile.id === currentUser.id)) {
      setProfile((prev) =>
        prev
          ? {
              ...prev,
              display_name: currentUser.display_name,
              username: currentUser.username,
              bio: currentUser.bio,
              location: currentUser.location,
              website: currentUser.website,
              avatar_url: currentUser.avatar_url || '',
              banner_url: currentUser.banner_url || '',
              is_private: currentUser.is_private,
            }
          : currentUser
      );
      setPosts((prev) =>
        prev.map((p) =>
          p.user_id === currentUser.id
            ? {
                ...p,
                avatar_url: currentUser.avatar_url || '',
                display_name: currentUser.display_name,
                username: currentUser.username,
              }
            : p
        )
      );
    }
  }, [
    isMe,
    currentUser?.id,
    currentUser?.avatar_url,
    currentUser?.banner_url,
    currentUser?.display_name,
    currentUser?.username,
    currentUser?.bio,
    currentUser?.location,
    currentUser?.website,
    currentUser?.is_private,
  ]);

  useEffect(() => {
    const onProfileUpdated = (e: Event) => {
      const updated = (e as CustomEvent<User>).detail;
      if (!updated) return;
      if (isMe || profile?.id === updated.id) {
        setProfile((prev) => (prev ? { ...prev, ...updated } : updated));
        setPosts((prev) =>
          prev.map((p) =>
            p.user_id === updated.id
              ? {
                  ...p,
                  avatar_url: updated.avatar_url || '',
                  display_name: updated.display_name,
                  username: updated.username,
                }
              : p
          )
        );
      }
    };
    const onPostUpdated = (e: Event) => {
      const detail = (e as CustomEvent<{ id: string; patch: Partial<Post> }>).detail;
      if (!detail?.id) return;
      setPosts((prev) => prev.map((p) => (p.id === detail.id ? { ...p, ...detail.patch } : p)));
      setLikedPosts((prev) => prev.map((p) => (p.id === detail.id ? { ...p, ...detail.patch } : p)));
      setTaggedPosts((prev) => prev.map((p) => (p.id === detail.id ? { ...p, ...detail.patch } : p)));
    };
    const onPostDeleted = (e: Event) => {
      const deletedId = (e as CustomEvent<string>).detail;
      if (!deletedId) return;
      setPosts((prev) => prev.filter((p) => p.id !== deletedId));
      setLikedPosts((prev) => prev.filter((p) => p.id !== deletedId));
      setTaggedPosts((prev) => prev.filter((p) => p.id !== deletedId));
    };

    window.addEventListener('sync:profile-updated', onProfileUpdated);
    window.addEventListener('sync:post-updated', onPostUpdated);
    window.addEventListener('sync:post-deleted', onPostDeleted);
    return () => {
      window.removeEventListener('sync:profile-updated', onProfileUpdated);
      window.removeEventListener('sync:post-updated', onPostUpdated);
      window.removeEventListener('sync:post-deleted', onPostDeleted);
    };
  }, [isMe, profile?.id]);

  // Real-time < 1s Firestore live subscription for profile stats, edits & posts
  useEffect(() => {
    if (!profile?.id) return;
    return api.subscribeUserProfile(profile.id, username.toLowerCase(), {
      onUserPatch: (patch) => {
        setProfile((prev) => (prev ? { ...prev, ...patch } : prev));
      },
      onPosts: (livePosts) => {
        if (!profile.is_private || profile.id === currentUser?.id || profile.is_following) {
          setPosts(livePosts);
        } else {
          setPosts([]);
        }
      },
    });
  }, [profile?.id, profile?.is_private, profile?.is_following, currentUser?.id, username, authConfirmedUid]);

  useEffect(() => {
    if (!profile?.id) {
      setIsProfileOnline(false);
      return;
    }
    return api.subscribeUserPresence(profile.id, setIsProfileOnline);
  }, [profile?.id]);

  const handleFollowToggle = async () => {
    if (!currentUser) {
      openAuth('login');
      return;
    }
    if (!profile) return;

    setFollowLoading(true);
    try {
      if (profile.is_following || profile.is_pending_request) {
        await api.unfollowUser(profile.id);
        soundFX.playUnlike();
        setProfile((prev) =>
          prev
            ? {
                ...prev,
                is_following: false,
                is_pending_request: false,
                followers_count: Math.max(0, (prev.followers_count || 1) - (prev.is_following ? 1 : 0)),
              }
            : null
        );
        showToast(`Unfollowed @${profile.username}`);
      } else {
        const res = await api.followUser(profile.id);
        soundFX.playSuccess();
        if (res.status === 'requested') {
          setProfile((prev) => (prev ? { ...prev, is_pending_request: true } : null));
          showToast('Follow request sent');
        } else {
          setProfile((prev) =>
            prev
              ? {
                  ...prev,
                  is_following: true,
                  followers_count: (prev.followers_count || 0) + 1,
                }
              : null
          );
          showToast(`Following @${profile.username}`);
        }
      }
    } catch (err: any) {
      showToast(err.message || 'Follow action failed');
    } finally {
      setFollowLoading(false);
    }
  };

  const handleBlockToggle = async () => {
    if (!profile || !currentUser) return;
    if (profile.is_blocked_by_me) {
      try {
        await api.unblockUser(profile.id);
        setProfile((p) => (p ? { ...p, is_blocked_by_me: false } : null));
        showToast(`Unblocked @${profile.username}`);
      } catch {
        showToast('Block action failed');
      }
    } else {
      setBlockConfirmOpen(true);
    }
  };

  const handleToggleCloseFriend = async () => {
    if (!currentUser) {
      openAuth('login');
      return;
    }
    if (!profile || closeFriendLoading) return;
    const prevVal = isCloseFriend;
    setCloseFriendLoading(true);
    setIsCloseFriend(!prevVal);
    try {
      if (prevVal) {
        await api.removeCloseFriend(profile.id);
        showToast(`Removed @${profile.username} from Close Friends`);
      } else {
        await api.addCloseFriend(profile.id);
        soundFX.playSuccess();
        showToast(`Added @${profile.username} to Close Friends`);
      }
    } catch {
      setIsCloseFriend(prevVal);
      showToast('Could not update Close Friends');
    } finally {
      setCloseFriendLoading(false);
    }
  };

  const confirmBlockUser = async () => {
    if (!profile || !currentUser) return;
    setBlockingUser(true);
    try {
      await api.blockUser(profile.id);
      setProfile((p) => (p ? { ...p, is_blocked_by_me: true, is_following: false } : null));
      setBlockConfirmOpen(false);
      showToast(`Blocked @${profile.username}`);
    } catch {
      showToast('Block action failed');
    } finally {
      setBlockingUser(false);
    }
  };

  if (loading && !profile) {
    return (
      <div className="pb-16 max-w-2xl mx-auto animate-pulse">
        <div className="glass-card rounded-3xl overflow-hidden border border-white/10 mb-6">
          <div className="h-40 sm:h-44 md:h-52 w-full bg-white/[0.06]" />
          <div className="px-4 sm:px-6 pb-6">
            <div className="flex items-end justify-between -mt-10 sm:-mt-14 mb-4">
              <div className="w-20 h-20 sm:w-28 sm:h-28 rounded-2xl sm:rounded-3xl bg-white/[0.12] border-4 border-black" />
              <div className="h-9 w-28 rounded-2xl bg-white/[0.08]" />
            </div>
            <div className="space-y-2.5">
              <div className="h-5 w-40 rounded-full bg-white/[0.1]" />
              <div className="h-3 w-24 rounded-full bg-white/[0.06]" />
              <div className="h-3.5 w-3/4 rounded-full bg-white/[0.06] mt-3" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="text-center py-20">
        <h3 className="text-lg font-medium text-white mb-2">Member not found</h3>
        <p className="text-xs text-zinc-500">The account @{username} does not exist or has been removed.</p>
      </div>
    );
  }

  return (
    <div className="pb-16 max-w-2xl mx-auto">
      {/* Back button */}
      {onBack && (
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 text-xs text-zinc-400 hover:text-white mb-3 min-h-[36px] px-1 transition"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Feed</span>
        </button>
      )}

      {/* Profile Card */}
      <div className="glass-card rounded-3xl overflow-hidden border border-white/10 mb-6 relative">
        {/* Banner */}
        <div className="h-36 sm:h-44 md:h-52 w-full relative bg-zinc-900 overflow-hidden">
          {profile.banner_url && !bannerFailed ? (
            <img
              src={profile.banner_url}
              alt="Banner"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={() => setBannerFailed(true)}
              className="w-full h-full object-cover opacity-85"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-zinc-950 via-zinc-900 to-black" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-transparent" />
        </div>

        {/* Profile Content */}
        <div className="px-4 sm:px-6 pb-5 sm:pb-6 pt-0 relative">
          {/* Avatar & Actions row */}
          <div className="flex items-end justify-between gap-2.5 -mt-10 sm:-mt-14 md:-mt-16 mb-3.5 sm:mb-4">
            <div className="relative shrink-0">
              <Avatar
                showPresence={false}
                name={profile.display_name}
                url={profile.avatar_url}
                size="xl"
                className="w-20 h-20 sm:w-28 sm:h-28 md:w-32 md:h-32 rounded-2xl sm:rounded-3xl border-4 border-black shadow-2xl"
              />
              {profile.is_verified ? (
                <div className="absolute bottom-1 right-1 p-1 rounded-full bg-white text-black shadow-md">
                  <Sparkles className="w-3.5 h-3.5" />
                </div>
              ) : null}
              {showOnlineDot && (
                <span
                  title="Online"
                  aria-label="Online"
                  className={`absolute ${
                    profile.is_verified
                      ? 'top-1 right-1 sm:top-1.5 sm:right-1.5'
                      : 'bottom-1 right-1 sm:bottom-1.5 sm:right-1.5'
                  } w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-full bg-emerald-400 ring-[3px] ring-black shadow-[0_0_10px_rgba(52,211,153,0.75)]`}
                />
              )}
            </div>

            <div className="flex items-center justify-end gap-1.5 sm:gap-2 flex-nowrap pt-2 shrink-0">
              {isMe ? (
                <>
                  <button
                    type="button"
                    onClick={onOpenEditProfile}
                    className="hidden sm:inline-flex glass-pill px-4 min-h-[40px] rounded-2xl text-xs font-semibold text-white items-center gap-1.5 hover:bg-white/15 cursor-pointer shadow-sm active:scale-95 transition whitespace-nowrap"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Edit Profile</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (onShareProfile) onShareProfile(profile.username);
                      else {
                        navigator.clipboard?.writeText(`${window.location.origin}/?u=${profile.username}`);
                        showToast('Profile link copied to clipboard');
                      }
                    }}
                    className="w-10 h-10 flex items-center justify-center rounded-2xl bg-white/[0.05] border border-white/10 text-zinc-300 hover:text-white hover:bg-white/10 transition active:scale-90 cursor-pointer"
                    title="Share My Profile Link"
                    aria-label="Share my profile link"
                  >
                    <Share2 className="w-4 h-4" />
                  </button>
                  {onOpenAlerts && (
                    <button
                      type="button"
                      onClick={() => {
                        soundFX.playTap();
                        onOpenAlerts();
                      }}
                      className="relative w-10 h-10 flex items-center justify-center rounded-2xl bg-white/[0.05] border border-white/10 text-zinc-300 hover:text-white hover:bg-white/10 transition active:scale-90 cursor-pointer"
                      title="Activity & Alerts"
                      aria-label="Activity and Alerts"
                    >
                      <Bell className="w-4 h-4" />
                      {unreadAlertsCount > 0 && (
                        <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-white" />
                      )}
                    </button>
                  )}
                  {onOpenSaved && (
                    <button
                      type="button"
                      onClick={() => {
                        soundFX.playTap();
                        onOpenSaved();
                      }}
                      className="w-10 h-10 flex items-center justify-center rounded-2xl bg-white/[0.05] border border-white/10 text-zinc-300 hover:text-white hover:bg-white/10 transition active:scale-90 cursor-pointer"
                      title="Saved Posts"
                      aria-label="Saved posts"
                    >
                      <Bookmark className="w-4 h-4" />
                    </button>
                  )}
                  {onOpenSettings && (
                    <button
                      type="button"
                      onClick={() => {
                        soundFX.playTap();
                        onOpenSettings();
                      }}
                      className="w-10 h-10 flex items-center justify-center rounded-2xl bg-white/[0.05] border border-white/10 text-zinc-300 hover:text-white hover:bg-white/10 transition active:scale-90 cursor-pointer"
                      title="Settings"
                      aria-label="Settings"
                    >
                      <Settings className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      soundFX.playTap();
                      openAccountSwitcher();
                    }}
                    className="w-10 h-10 flex items-center justify-center rounded-2xl bg-white/[0.05] border border-white/10 text-zinc-300 hover:text-white hover:bg-white/10 transition active:scale-90 cursor-pointer"
                    title="Switch or Add Account"
                    aria-label="Switch or add account"
                  >
                    <ArrowLeftRight className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleFollowToggle}
                    disabled={followLoading}
                    className={`hidden sm:inline-flex px-5 min-h-[40px] rounded-2xl text-xs font-semibold items-center gap-1.5 transition active:scale-95 cursor-pointer whitespace-nowrap ${
                      profile.is_following
                        ? 'bg-white/10 text-white border border-white/20 hover:bg-white/20'
                        : profile.is_pending_request
                        ? 'bg-zinc-800 text-zinc-300 border border-white/10'
                        : 'glass-button-primary'
                    }`}
                  >
                    {profile.is_following ? (
                      <>
                        <UserCheck className="w-3.5 h-3.5" />
                        <span>Following</span>
                      </>
                    ) : profile.is_pending_request ? (
                      <>
                        <Clock className="w-3.5 h-3.5" />
                        <span>Requested</span>
                      </>
                    ) : (
                      <>
                        <UserPlus className="w-3.5 h-3.5" />
                        <span>Follow</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (!currentUser) openAuth('login');
                      else if (onOpenChat) onOpenChat(profile.id);
                    }}
                    className="hidden sm:inline-flex px-4 min-h-[40px] rounded-2xl bg-white/[0.06] border border-white/15 text-white hover:bg-white/15 text-xs font-semibold items-center gap-1.5 transition active:scale-95 cursor-pointer shadow-sm whitespace-nowrap"
                    title="Send Private Message"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    <span>Message</span>
                  </button>

                  {currentUser && (
                    <button
                      type="button"
                      onClick={handleToggleCloseFriend}
                      disabled={closeFriendLoading}
                      className={`w-10 h-10 flex items-center justify-center rounded-2xl border transition active:scale-90 cursor-pointer ${
                        isCloseFriend
                          ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-400'
                          : 'bg-white/[0.05] border-white/10 text-zinc-300 hover:text-emerald-300 hover:bg-white/10'
                      }`}
                      title={isCloseFriend ? 'In Close Friends' : 'Add to Close Friends'}
                      aria-label={isCloseFriend ? 'Remove from Close Friends' : 'Add to Close Friends'}
                    >
                      <Star className={`w-4 h-4 ${isCloseFriend ? 'fill-emerald-400' : ''}`} />
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      if (onShareProfile) onShareProfile(profile.username);
                      else {
                        navigator.clipboard?.writeText(`${window.location.origin}/?u=${profile.username}`);
                        showToast(`Link to @${profile.username} copied`);
                      }
                    }}
                    className="w-10 h-10 flex items-center justify-center rounded-2xl bg-white/[0.05] border border-white/10 text-zinc-300 hover:text-white hover:bg-white/10 transition active:scale-90 cursor-pointer"
                    title="Share Profile Link"
                    aria-label="Share profile link"
                  >
                    <Share2 className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={handleBlockToggle}
                    className="w-10 h-10 flex items-center justify-center rounded-2xl bg-white/[0.05] border border-white/10 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition active:scale-90 cursor-pointer"
                    title={profile.is_blocked_by_me ? 'Unblock user' : 'Block user'}
                    aria-label={profile.is_blocked_by_me ? 'Unblock user' : 'Block user'}
                  >
                    <Ban className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
          </div>

          {/* User Details */}
          <div className="mb-4">
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="text-xl font-bold text-white truncate">{profile.display_name}</h2>
              {profile.is_private ? (
                <span title="Private Account" className="shrink-0">
                  <Lock className="w-4 h-4 text-zinc-400" />
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-2 text-xs text-zinc-500 font-mono mt-0.5">
              <span>@{profile.username}</span>
              {showOnlineDot && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-emerald-400 font-sans font-medium">Online</span>
                </>
              )}
            </div>

            {profile.bio && (
              <p className="text-sm text-zinc-300 mt-3 whitespace-pre-wrap break-words leading-relaxed">
                {profile.bio}
              </p>
            )}

            {/* Metadata */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-zinc-400 mt-3.5">
              {profile.location && (
                <div className="flex items-center gap-1.5 min-w-0">
                  <MapPin className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                  <span className="truncate">{profile.location}</span>
                </div>
              )}
              {profile.website && (
                <a
                  href={profile.website.startsWith('http') ? profile.website : `https://${profile.website}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 text-zinc-300 hover:text-white hover:underline transition min-w-0 max-w-full"
                >
                  <LinkIcon className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                  <span className="truncate">{profile.website.replace(/^https?:\/\//, '')}</span>
                </a>
              )}
              <div className="flex items-center gap-1.5 text-zinc-500">
                <Calendar className="w-3.5 h-3.5" />
                <span>Joined {profile.created_at ? new Date(profile.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : 'recently'}</span>
              </div>
            </div>

            {/* Mobile Primary Action Bar (Full-width, zero jagged wrap) */}
            <div className="flex sm:hidden items-center gap-2 mt-4">
              {isMe ? (
                <button
                  type="button"
                  onClick={onOpenEditProfile}
                  className="flex-1 glass-pill px-4 min-h-[42px] rounded-2xl text-xs font-semibold text-white flex items-center justify-center gap-2 hover:bg-white/15 cursor-pointer shadow-sm active:scale-[0.98] transition whitespace-nowrap"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Edit Profile</span>
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleFollowToggle}
                    disabled={followLoading}
                    className={`flex-1 px-4 min-h-[42px] rounded-2xl text-xs font-semibold flex items-center justify-center gap-1.5 transition active:scale-[0.98] cursor-pointer whitespace-nowrap ${
                      profile.is_following
                        ? 'bg-white/10 text-white border border-white/20 hover:bg-white/20'
                        : profile.is_pending_request
                        ? 'bg-zinc-800 text-zinc-300 border border-white/10'
                        : 'glass-button-primary'
                    }`}
                  >
                    {profile.is_following ? (
                      <>
                        <UserCheck className="w-3.5 h-3.5" />
                        <span>Following</span>
                      </>
                    ) : profile.is_pending_request ? (
                      <>
                        <Clock className="w-3.5 h-3.5" />
                        <span>Requested</span>
                      </>
                    ) : (
                      <>
                        <UserPlus className="w-3.5 h-3.5" />
                        <span>Follow</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (!currentUser) openAuth('login');
                      else if (onOpenChat) onOpenChat(profile.id);
                    }}
                    className="flex-1 px-4 min-h-[42px] rounded-2xl bg-white/[0.06] border border-white/15 text-white hover:bg-white/15 text-xs font-semibold flex items-center justify-center gap-1.5 transition active:scale-[0.98] cursor-pointer shadow-sm whitespace-nowrap"
                    title="Send Private Message"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    <span>Message</span>
                  </button>
                </>
              )}
            </div>

            {/* Mutual followers indicator */}
            {profile.mutual_followers && profile.mutual_followers.length > 0 && (
              <div className="mt-3.5 pt-3 border-t border-white/[0.06] flex items-center gap-2 text-xs text-zinc-400">
                <div className="flex -space-x-1.5">
                  {profile.mutual_followers.map((mf, idx) => (
                    <Avatar
                      key={idx}
                      name={mf.display_name || mf.username}
                      url={mf.avatar_url}
                      size="2xs"
                      className="ring-2 ring-black"
                    />
                  ))}
                </div>
                <span>
                  Followed by{' '}
                  <strong className="text-zinc-200">
                    @{profile.mutual_followers[0].username}
                  </strong>{' '}
                  {profile.mutual_followers.length > 1
                    ? `and ${profile.mutual_followers.length - 1} other${profile.mutual_followers.length > 2 ? 's' : ''}`
                    : ''}
                </span>
              </div>
            )}
          </div>

          {/* Followers / Following counts */}
          <div className="flex items-center gap-6 pt-3 border-t border-white/[0.08]">
            <div className="flex items-center gap-1.5 text-sm">
              <span className="font-bold text-white font-mono tabular-nums">{profile.posts_count || posts.length}</span>
              <span className="text-zinc-500 text-xs">posts</span>
            </div>
            <button
              type="button"
              onClick={() => onOpenFollowers(profile.username)}
              className="flex items-center gap-1.5 text-sm hover:opacity-80 transition cursor-pointer min-h-[36px]"
            >
              <span className="font-bold text-white font-mono tabular-nums">{profile.followers_count || 0}</span>
              <span className="text-zinc-500 text-xs">followers</span>
            </button>
            <button
              type="button"
              onClick={() => onOpenFollowing(profile.username)}
              className="flex items-center gap-1.5 text-sm hover:opacity-80 transition cursor-pointer min-h-[36px]"
            >
              <span className="font-bold text-white font-mono tabular-nums">{profile.following_count || 0}</span>
              <span className="text-zinc-500 text-xs">following</span>
            </button>
          </div>
        </div>
      </div>

      {/* Current User SP Level Progress Bar beneath Profile Header */}
      {isMe && currentUser && (
        <SpLevelProgressBar
          variant="profile"
          onOpenLeaderboard={onOpenLeaderboard}
        />
      )}

      {/* Story Highlights Strip */}
      {(highlights.length > 0 || isMe) && (
        <div className="glass-card rounded-2xl p-3.5 sm:p-4 mb-5 border border-white/[0.08]">
          <div className="flex items-center gap-3.5 overflow-x-auto no-scrollbar py-0.5">
            {isMe && (
              <button
                type="button"
                onClick={() => {
                  soundFX.playTap();
                  setNewHltTitle('');
                  setNewHltImage('');
                  setNewHltCaption('');
                  setNewHighlightModalOpen(true);
                }}
                className="flex flex-col items-center gap-1.5 shrink-0 cursor-pointer group"
              >
                <div className="w-14 h-14 sm:w-15 sm:h-15 rounded-full border border-dashed border-white/25 group-hover:border-white bg-white/[0.03] flex items-center justify-center text-zinc-300 group-hover:text-white transition">
                  <Plus className="w-5 h-5" />
                </div>
                <span className="text-[11px] font-medium text-zinc-400 group-hover:text-white">New</span>
              </button>
            )}
            {highlights.map((hlt) => (
              <button
                key={hlt.id}
                type="button"
                onClick={() => {
                  if (!hlt.items || hlt.items.length === 0) return;
                  soundFX.playTap();
                  setActiveHighlightViewer({ highlight: hlt, index: 0 });
                }}
                className="flex flex-col items-center gap-1.5 shrink-0 cursor-pointer group"
              >
                <div className="w-14 h-14 sm:w-15 sm:h-15 rounded-full p-[2px] border border-white/25 group-hover:border-white transition">
                  <div className="w-full h-full rounded-full overflow-hidden bg-zinc-900">
                    <img
                      src={hlt.cover_url}
                      alt={hlt.title}
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                      }}
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
                <span className="text-[11px] font-medium text-zinc-300 group-hover:text-white max-w-[66px] truncate">
                  {hlt.title}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center justify-center border-b border-white/[0.08] mb-6 relative overflow-x-auto no-scrollbar">
        <button
          onClick={() => setActiveTab('posts')}
          className={`relative flex items-center gap-1.5 sm:gap-2 py-3.5 px-3.5 sm:px-5 text-xs font-semibold tracking-wider uppercase transition cursor-pointer select-none shrink-0 ${
            activeTab === 'posts'
              ? 'text-white'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>Posts</span>
          {activeTab === 'posts' && (
            <motion.div
              layoutId="active-profile-tab"
              className="absolute bottom-0 inset-x-0 h-[2px] bg-white shadow-[0_0_10px_rgba(255,255,255,0.8)]"
              transition={{ type: 'spring', stiffness: 500, damping: 35 }}
            />
          )}
        </button>
        <button
          onClick={() => setActiveTab('grid')}
          className={`relative flex items-center gap-1.5 sm:gap-2 py-3.5 px-3.5 sm:px-5 text-xs font-semibold tracking-wider uppercase transition cursor-pointer select-none shrink-0 ${
            activeTab === 'grid'
              ? 'text-white'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <Grid className="w-3.5 h-3.5" />
          <span>Grid</span>
          {activeTab === 'grid' && (
            <motion.div
              layoutId="active-profile-tab"
              className="absolute bottom-0 inset-x-0 h-[2px] bg-white shadow-[0_0_10px_rgba(255,255,255,0.8)]"
              transition={{ type: 'spring', stiffness: 500, damping: 35 }}
            />
          )}
        </button>
        <button
          onClick={() => setActiveTab('likes')}
          className={`relative flex items-center gap-1.5 sm:gap-2 py-3.5 px-3.5 sm:px-5 text-xs font-semibold tracking-wider uppercase transition cursor-pointer select-none shrink-0 ${
            activeTab === 'likes'
              ? 'text-white'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <Heart className="w-3.5 h-3.5" />
          <span>Liked</span>
          {activeTab === 'likes' && (
            <motion.div
              layoutId="active-profile-tab"
              className="absolute bottom-0 inset-x-0 h-[2px] bg-white shadow-[0_0_10px_rgba(255,255,255,0.8)]"
              transition={{ type: 'spring', stiffness: 500, damping: 35 }}
            />
          )}
        </button>
        <button
          onClick={() => setActiveTab('tagged')}
          className={`relative flex items-center gap-1.5 sm:gap-2 py-3.5 px-3.5 sm:px-5 text-xs font-semibold tracking-wider uppercase transition cursor-pointer select-none shrink-0 ${
            activeTab === 'tagged'
              ? 'text-white'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <AtSign className="w-3.5 h-3.5" />
          <span>Tagged</span>
          {activeTab === 'tagged' && (
            <motion.div
              layoutId="active-profile-tab"
              className="absolute bottom-0 inset-x-0 h-[2px] bg-white shadow-[0_0_10px_rgba(255,255,255,0.8)]"
              transition={{ type: 'spring', stiffness: 500, damping: 35 }}
            />
          )}
        </button>
      </div>

      {/* Posts Section */}
      {activeTab === 'posts' && (
        <div className="flex flex-col">
          {posts.length === 0 ? (
            <div className="glass-card rounded-3xl p-10 text-center border border-white/5">
              <h4 className="text-sm font-semibold text-white mb-1">No posts yet</h4>
              <p className="text-xs text-zinc-500">
                {isMe ? 'Share your first photograph or contemplation.' : `@${profile.username} has not posted anything yet.`}
              </p>
            </div>
          ) : (
            sortedProfilePosts.map((post, idx) => (
              <PostCard
                key={post.id}
                post={post}
                showPinnedBadge
                priorityImage={idx < 2}
                onOpenProfile={(u) => {
                  if (u.toLowerCase() !== username.toLowerCase()) {
                    if (onOpenProfile) onOpenProfile(u);
                    else loadProfile();
                  }
                }}
                onOpenLikedBy={onOpenLikedBy}
                onOpenReport={onOpenReport}
                onQuotePost={onQuotePost}
                onRepostCreated={(newPost) => {
                  onRepostCreated?.(newPost);
                  if (isMe) setPosts((prev) => [newPost, ...prev]);
                }}
                onPostUpdated={(updated) =>
                  setPosts((prev) =>
                    prev.map((p) => (p.id === post.id ? { ...p, ...updated } : p))
                  )
                }
                onPostDeleted={(id) => setPosts((prev) => prev.filter((p) => p.id !== id))}
              />
            ))
          )}
        </div>
      )}

      {/* Instagram-style 3-Column Photo Grid */}
      {activeTab === 'grid' && (
        <div>
          {sortedProfilePosts.filter((p) => p.images && p.images.length > 0).length === 0 ? (
            <div className="glass-card rounded-3xl p-10 text-center border border-white/5">
              <Grid className="w-7 h-7 text-zinc-600 mx-auto mb-2.5" />
              <h4 className="text-sm font-semibold text-white mb-1">No photos yet</h4>
              <p className="text-xs text-zinc-500">
                {isMe ? 'Photos you share will appear in your gallery grid.' : `@${profile.username} has not shared any photos yet.`}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-1.5 sm:gap-2.5">
              {sortedProfilePosts
                .filter((p) => p.images && p.images.length > 0)
                .map((post) => (
                  <button
                    key={post.id}
                    type="button"
                    onClick={() => {
                      soundFX.playTap();
                      if (onOpenPost) onOpenPost(post);
                    }}
                    className="relative aspect-square rounded-xl sm:rounded-2xl overflow-hidden bg-zinc-900 border border-white/10 group cursor-pointer"
                  >
                    {failedGridIds[post.id] ? (
                      <div className="w-full h-full flex items-center justify-center text-[10px] text-zinc-500 bg-zinc-900">
                        Unavailable
                      </div>
                    ) : (
                      <img
                        src={post.images![0]}
                        alt="Gallery item"
                        loading="lazy"
                        decoding="async"
                        referrerPolicy="no-referrer"
                        onError={() => setFailedGridIds((prev) => ({ ...prev, [post.id]: true }))}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    )}
                    {post.is_pinned && (
                      <span className="absolute top-2 left-2 p-1 rounded-md bg-black/75 text-white">
                        <Pin className="w-3 h-3 fill-white" />
                      </span>
                    )}
                    {post.images!.length > 1 && (
                      <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded-md bg-black/70 text-[10px] font-mono text-white">
                        1/{post.images!.length}
                      </span>
                    )}
                    <div className="absolute inset-0 bg-black/55 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3 text-xs font-semibold text-white tabular-nums">
                      <span className="inline-flex items-center gap-1">
                        <Heart className="w-3.5 h-3.5 fill-white" />
                        {post.likes_count || 0}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <MessageSquare className="w-3.5 h-3.5 fill-white" />
                        {post.comments_count || 0}
                      </span>
                    </div>
                  </button>
                ))}
            </div>
          )}
        </div>
      )}

      {/* Liked Section */}
      {activeTab === 'likes' && (
        <div className="flex flex-col">
          {likedPosts.length === 0 ? (
            <div className="glass-card rounded-3xl p-10 text-center border border-white/5">
              <h4 className="text-sm font-semibold text-white mb-1">No liked posts</h4>
              <p className="text-xs text-zinc-500">Posts liked by this user will appear here.</p>
            </div>
          ) : (
            likedPosts.map((post, idx) => (
              <PostCard
                key={post.id}
                post={post}
                priorityImage={idx < 2}
                onOpenProfile={(u) => {
                  if (u.toLowerCase() !== username.toLowerCase()) {
                    if (onOpenProfile) onOpenProfile(u);
                    else loadProfile();
                  }
                }}
                onOpenLikedBy={onOpenLikedBy}
                onOpenReport={onOpenReport}
                onQuotePost={onQuotePost}
                onRepostCreated={onRepostCreated}
                onPostUpdated={(updated) =>
                  setLikedPosts((prev) =>
                    prev.map((p) => (p.id === post.id ? { ...p, ...updated } : p))
                  )
                }
                onPostDeleted={(id) => setLikedPosts((prev) => prev.filter((p) => p.id !== id))}
              />
            ))
          )}
        </div>
      )}

      {/* Tagged Section */}
      {activeTab === 'tagged' && (
        <div className="flex flex-col gap-5">
          {taggedStories.length > 0 && (
            <div className="glass-card rounded-3xl p-4 border border-white/10">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">
                Tagged in Active Stories
              </h4>
              <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
                {taggedStories.map((ts) => (
                  <button
                    key={ts.story.id}
                    type="button"
                    onClick={() => {
                      soundFX.playTap();
                      onOpenProfile?.(ts.authorUsername);
                    }}
                    className="w-24 shrink-0 rounded-2xl overflow-hidden border border-white/15 bg-black relative aspect-[3/4] group cursor-pointer"
                  >
                    <img
                      src={ts.story.imageUrl}
                      alt={ts.authorUsername}
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                      }}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    />
                    <div className="absolute inset-x-0 bottom-0 p-1.5 bg-gradient-to-t from-black/90 to-transparent text-left">
                      <span className="text-[10px] font-mono text-white block truncate">
                        @{ts.authorUsername}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {taggedPosts.length === 0 && taggedStories.length === 0 ? (
            <div className="glass-card rounded-3xl p-10 text-center border border-white/5">
              <AtSign className="w-7 h-7 text-zinc-600 mx-auto mb-2.5" />
              <h4 className="text-sm font-semibold text-white mb-1">No tagged content yet</h4>
              <p className="text-xs text-zinc-500">
                Posts and active stories mentioning @{profile.username} will appear here.
              </p>
            </div>
          ) : (
            taggedPosts.map((post, idx) => (
              <PostCard
                key={post.id}
                post={post}
                priorityImage={idx < 2}
                onOpenProfile={(u) => {
                  if (u.toLowerCase() !== username.toLowerCase()) {
                    if (onOpenProfile) onOpenProfile(u);
                    else loadProfile();
                  }
                }}
                onOpenLikedBy={onOpenLikedBy}
                onOpenReport={onOpenReport}
                onQuotePost={onQuotePost}
                onRepostCreated={onRepostCreated}
                onPostUpdated={(updated) =>
                  setTaggedPosts((prev) =>
                    prev.map((p) => (p.id === post.id ? { ...p, ...updated } : p))
                  )
                }
                onPostDeleted={(id) => setTaggedPosts((prev) => prev.filter((p) => p.id !== id))}
              />
            ))
          )}
        </div>
      )}

      {/* Highlight Viewer */}
      {activeHighlightViewer &&
        typeof document !== 'undefined' &&
        createPortal(
          <StoryViewerModal
            group={{
              userId: profile.id,
              username: profile.username,
              displayName: profile.display_name,
              avatarUrl: profile.avatar_url || '',
              isVerified: !!profile.is_verified,
              hasUnviewed: false,
              stories: (activeHighlightViewer.highlight.items || []).map((item) => ({
                id: item.id,
                imageUrl: item.image_url,
                caption: item.caption,
                tags: item.tags || [],
                createdAt: item.created_at,
                expiresAt: item.created_at,
                isViewed: true,
              })),
            }}
            storyIndex={activeHighlightViewer.index}
            canDelete={!!isMe}
            isHighlightMode
            highlightTitle={activeHighlightViewer.highlight.title}
            onDeleteHighlight={async () => {
              const targetId = activeHighlightViewer.highlight.id;
              try {
                await api.deleteHighlight(targetId);
                setHighlights((prev) => prev.filter((h) => h.id !== targetId));
                setActiveHighlightViewer(null);
                showToast('Highlight deleted');
              } catch {
                showToast('Could not delete highlight');
              }
            }}
            onClose={() => setActiveHighlightViewer(null)}
            onNext={() => {
              const total = activeHighlightViewer.highlight.items?.length || 0;
              if (activeHighlightViewer.index < total - 1) {
                setActiveHighlightViewer((prev) =>
                  prev ? { ...prev, index: prev.index + 1 } : null
                );
              } else {
                setActiveHighlightViewer(null);
              }
            }}
            onPrev={() => {
              if (activeHighlightViewer.index > 0) {
                setActiveHighlightViewer((prev) =>
                  prev ? { ...prev, index: prev.index - 1 } : null
                );
              }
            }}
            onDelete={() => {}}
            onMarkViewed={() => {}}
            onOpenProfile={onOpenProfile}
          />,
          document.body
        )}

      {/* Create New Highlight Modal */}
      {newHighlightModalOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            onClick={(e) => {
              if (e.target === e.currentTarget && !creatingHighlight) setNewHighlightModalOpen(false);
            }}
            className="fixed inset-0 z-[110] bg-black/85 backdrop-blur-xl flex items-center justify-center p-4"
          >
            <div className="glass-surface w-full max-w-sm rounded-3xl p-6 border border-white/15 shadow-2xl">
              <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-4">
                <h3 className="text-sm font-semibold text-white">New Story Highlight</h3>
                <button
                  type="button"
                  onClick={() => !creatingHighlight && setNewHighlightModalOpen(false)}
                  aria-label="Close new highlight modal"
                  className="w-9 h-9 flex items-center justify-center rounded-full text-zinc-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!newHltImage) {
                    showToast('Please select a photo for this highlight');
                    return;
                  }
                  setCreatingHighlight(true);
                  try {
                    const res = await api.createHighlight(newHltTitle || 'Highlights', newHltImage, {
                      imageUrl: newHltImage,
                      caption: newHltCaption,
                    });
                    setHighlights((prev) => [res.highlight, ...prev]);
                    soundFX.playSuccess();
                    showToast('Highlight created');
                    setNewHighlightModalOpen(false);
                  } catch {
                    showToast('Could not create highlight');
                  } finally {
                    setCreatingHighlight(false);
                  }
                }}
                className="flex flex-col gap-3.5"
              >
                <label className="border-2 border-dashed border-white/20 hover:border-white/40 rounded-2xl p-5 flex flex-col items-center justify-center gap-2 cursor-pointer transition bg-white/[0.02]">
                  <Upload className="w-5 h-5 text-zinc-400" />
                  <span className="text-xs text-zinc-300 font-medium">
                    {newHltImage ? 'Change highlight photo' : 'Choose cover photo'}
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      e.target.value = '';
                      const reader = new FileReader();
                      reader.onload = async () => {
                        try {
                          const res = await api.uploadImage(reader.result as string);
                          setNewHltImage(res.url);
                        } catch {
                          showToast('Image upload failed');
                        }
                      };
                      reader.readAsDataURL(file);
                    }}
                    className="hidden"
                  />
                </label>
                {newHltImage && (
                  <div className="h-32 rounded-2xl overflow-hidden border border-white/15">
                    <img src={newHltImage} alt="Highlight cover" className="w-full h-full object-cover" />
                  </div>
                )}
                <input
                  type="text"
                  value={newHltTitle}
                  onChange={(e) => setNewHltTitle(e.target.value)}
                  maxLength={32}
                  placeholder="Highlight title (e.g. Travels)"
                  className="glass-input w-full px-3.5 py-2.5 rounded-xl text-xs"
                />
                <input
                  type="text"
                  value={newHltCaption}
                  onChange={(e) => setNewHltCaption(e.target.value)}
                  maxLength={100}
                  placeholder="Optional caption..."
                  className="glass-input w-full px-3.5 py-2.5 rounded-xl text-xs"
                />
                <button
                  type="submit"
                  disabled={creatingHighlight || !newHltImage}
                  className="glass-button-primary py-2.5 text-xs font-semibold disabled:opacity-50 cursor-pointer"
                >
                  {creatingHighlight ? 'Creating...' : 'Save Highlight'}
                </button>
              </form>
            </div>
          </div>,
          document.body
        )}

      {/* Block User Warning Pop-up */}
      <WarningPopup
        open={blockConfirmOpen}
        title={`Block @${profile.username}?`}
        message="Their posts will no longer appear in your feed and you will unfollow them. You can unblock anytime in Settings."
        confirmLabel="Block User"
        tone="danger"
        loading={blockingUser}
        loadingLabel="Blocking..."
        onCancel={() => !blockingUser && setBlockConfirmOpen(false)}
        onConfirm={confirmBlockUser}
      />
    </div>
  );
};
