import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Navigation, ActiveTab } from './components/Navigation';
import { StoriesBar } from './components/StoriesBar';
import { CreatePostBox } from './components/CreatePostBox';
import { PostCard } from './components/PostCard';
import { UserProfileView } from './components/UserProfileView';
import { ChatView } from './components/ChatView';
import { NotificationsView } from './components/NotificationsView';
import { ExploreView } from './components/ExploreView';
import { BookmarksView } from './components/BookmarksView';
import { SettingsView } from './components/SettingsView';
import { AuthModal } from './components/AuthModal';
import {
  EditProfileModal,
  FollowersModal,
  LikedByModal,
  ReportModal,
  InviteModal,
  SignOutConfirmModal,
} from './components/Modals';
import { InstallAppModal } from './components/InstallAppModal';
import { LeaderboardView } from './components/LeaderboardView';
import { RightLeaderboardSidebar } from './components/RightLeaderboardSidebar';
import { AccountSwitcherModal } from './components/AccountSwitcherModal';
import { Post, User } from './types';
import { motion, AnimatePresence } from 'motion/react';
import { api } from './lib/api';
import { NativeBridge } from './lib/native';
import { bindAudioUnlock, soundFX } from './lib/sounds';
import { Sparkles, RefreshCw, UserPlus, Plus, AlertTriangle, X } from 'lucide-react';

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error('Unhandled SYNC UI error:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-black text-white flex items-center justify-center p-6">
          <div className="glass-surface rounded-3xl p-8 max-w-sm w-full text-center border border-white/15">
            <h2 className="text-lg font-bold mb-2">Something went wrong</h2>
            <p className="text-xs text-zinc-400 mb-5 leading-relaxed">
              An unexpected error occurred while rendering this view.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="glass-button-primary px-6 py-2.5 text-xs font-semibold cursor-pointer"
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function NoirMain() {
  const { user, counts, loading: authLoading, authConfirmedUid, storagePersistent, openAuth, showToast, activeToast } = useAuth();
  const [activeTab, setActiveTab] = useState<ActiveTab>(() => {
    if (typeof window === 'undefined') return 'home';
    const params = new URLSearchParams(window.location.search);
    if (params.get('u')) return 'profile';
    return (params.get('tab') as ActiveTab | null) || 'home';
  });
  const [activeProfileUsername, setActiveProfileUsername] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('u');
  });
  const [activeChatRecipientId, setActiveChatRecipientId] = useState<string | null>(null);
  const [activeChatConvId, setActiveChatConvId] = useState<string | null>(null);

  // Feed states (instant SWR hydration)
  const [feedType, setFeedType] = useState<'for_you' | 'following' | 'latest'>('for_you');
  const [posts, setPosts] = useState<Post[]>(() => api.getCachedPosts({ feed: 'for_you' }) || []);
  const [loadingPosts, setLoadingPosts] = useState(() => {
    const cached = api.getCachedPosts({ feed: 'for_you' });
    return !cached || cached.length === 0;
  });
  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('tag');
  });
  const [invitedByUsername, setInvitedByUsername] = useState<string | null>(null);

  // Modals state
  const [createPostModalOpen, setCreatePostModalOpen] = useState(false);
  const [editProfileModalOpen, setEditProfileModalOpen] = useState(false);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [installAppModalOpen, setInstallAppModalOpen] = useState(false);
  const [followersModal, setFollowersModal] = useState<{ username: string; type: 'followers' | 'following' } | null>(null);
  const [likedByModalPostId, setLikedByModalPostId] = useState<string | null>(null);
  const [reportModalTargetId, setReportModalTargetId] = useState<string | null>(null);
  const [sharedPost, setSharedPost] = useState<Post | null>(null);
  const [quoteTargetPost, setQuoteTargetPost] = useState<Post | null>(null);

  // Feed manual refresh helper (kept for manual refresh CTA)
  const fetchFeed = async () => {
    try {
      const data = await api.getPosts({ feed: feedType, tag: activeTagFilter || undefined });
      setPosts(data.posts || []);
    } catch (err: any) {
      console.warn('Unable to load feed:', err?.message || err);
    } finally {
      setLoadingPosts(false);
    }
  };

  // Real-time < 1s Firestore live stream for Home Feed
  useEffect(() => {
    const cached = api.getCachedPosts({ feed: feedType, tag: activeTagFilter || undefined });
    if (cached && cached.length > 0) {
      setPosts(cached);
      setLoadingPosts(false);
    } else {
      setLoadingPosts(true);
    }

    const safetyTimer = setTimeout(() => {
      setLoadingPosts(false);
    }, 3500);

    const unsubscribe = api.subscribeFeed(
      { feed: feedType, tag: activeTagFilter || undefined },
      (livePosts) => {
        clearTimeout(safetyTimer);
        setPosts(livePosts);
        setLoadingPosts(false);
      }
    );

    return () => {
      clearTimeout(safetyTimer);
      unsubscribe();
    };
  }, [feedType, activeTagFilter, authConfirmedUid]);

  // Background pre-warm own profile, posts, notifications, bookmarks, conversations & directory right after auth resolves
  useEffect(() => {
    if (!authConfirmedUid || !user?.username) return;
    const timer = setTimeout(() => {
      api.getProfile(user.username).catch(() => {});
      api.getUserPosts(user.username).catch(() => {});
      api.getNotifications().catch(() => {});
      api.getBookmarks().catch(() => {});
      api.getConversations().catch(() => {});
      api.getSuggestedUsers().catch(() => {});
    }, 180);
    return () => clearTimeout(timer);
  }, [authConfirmedUid, user?.username]);

  // Reset user-scoped UI state & update own-profile route whenever active account switches
  const prevSessionRef = React.useRef<{ uid: string | null; username: string | null }>({
    uid: user?.id || null,
    username: user?.username || null,
  });
  useEffect(() => {
    const prev = prevSessionRef.current;
    const nextUid = user?.id || null;
    const nextUsername = user?.username || null;

    if (prev.uid !== nextUid) {
      setEditProfileModalOpen(false);
      setFollowersModal(null);
      setQuoteTargetPost(null);
      setCreatePostModalOpen(false);
      setActiveChatConvId(null);
      setActiveChatRecipientId(null);

      if (prev.uid && nextUid) {
        if (activeTab === 'profile' && prev.username && activeProfileUsername === prev.username && nextUsername) {
          setActiveProfileUsername(nextUsername);
          window.history.replaceState(null, '', `?u=${nextUsername}`);
        }
        window.scrollTo({ top: 0, behavior: 'auto' });
      } else if (prev.uid && !nextUid) {
        if (
          activeTab === 'messages' ||
          activeTab === 'notifications' ||
          activeTab === 'bookmarks' ||
          activeTab === 'settings'
        ) {
          setActiveTab('home');
          window.history.replaceState(null, '', '/');
        }
      }
    }

    prevSessionRef.current = { uid: nextUid, username: nextUsername };
  }, [user?.id, user?.username, activeTab, activeProfileUsername]);

  // Native Android initialization & mobile audio unlock + hardware back button handling
  useEffect(() => {
    NativeBridge.init();
    bindAudioUnlock();

    const handlePopState = () => {
      // If any modal is open, dismiss it first on hardware back
      if (
        createPostModalOpen ||
        editProfileModalOpen ||
        inviteModalOpen ||
        installAppModalOpen ||
        followersModal ||
        likedByModalPostId ||
        reportModalTargetId ||
        sharedPost ||
        quoteTargetPost
      ) {
        setCreatePostModalOpen(false);
        setEditProfileModalOpen(false);
        setInviteModalOpen(false);
        setInstallAppModalOpen(false);
        setFollowersModal(null);
        setLikedByModalPostId(null);
        setReportModalTargetId(null);
        setSharedPost(null);
        setQuoteTargetPost(null);
        return;
      }
      if (activeProfileUsername || activeChatRecipientId || activeChatConvId || activeTab !== 'home') {
        setActiveProfileUsername(null);
        setActiveChatRecipientId(null);
        setActiveChatConvId(null);
        setActiveTab('home');
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [
    createPostModalOpen,
    editProfileModalOpen,
    inviteModalOpen,
    installAppModalOpen,
    followersModal,
    likedByModalPostId,
    reportModalTargetId,
    sharedPost,
    quoteTargetPost,
    activeProfileUsername,
    activeChatRecipientId,
    activeChatConvId,
    activeTab,
  ]);

  // Handle URL query parameters for post deep-links & invites once on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const postParam = params.get('post');
    const inviteParam = params.get('invite') || params.get('u');

    if (inviteParam && !user) {
      setInvitedByUsername(inviteParam);
    }

    if (postParam) {
      api.getPost(postParam)
        .then((res) => setSharedPost(res.post))
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!sharedPost) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSharedPost(null);
        window.history.replaceState(null, '', '/');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sharedPost]);

  useEffect(() => {
    if (user && invitedByUsername) {
      setInvitedByUsername(null);
    }
  }, [user, invitedByUsername]);

  // Listen for tag search, live profile PFP updates, cross-view post sync, and transparent SP breakdown toasts
  useEffect(() => {
    const handleTagSearch = (e: any) => {
      setActiveTagFilter(e.detail);
      setActiveTab('home');
      setActiveProfileUsername(null);
      window.history.pushState(null, '', '/');
    };
    const handleProfileUpdated = (e: Event) => {
      const updated = (e as CustomEvent<User>).detail;
      if (!updated) return;
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
      setSharedPost((prev) =>
        prev && prev.user_id === updated.id
          ? {
              ...prev,
              avatar_url: updated.avatar_url || '',
              display_name: updated.display_name,
              username: updated.username,
            }
          : prev
      );
    };
    const handlePostCreated = (e: Event) => {
      const newPost = (e as CustomEvent<Post>).detail;
      if (!newPost) return;
      if (activeTagFilter && !(newPost.content || '').toLowerCase().includes(`#${activeTagFilter.toLowerCase()}`)) {
        return;
      }
      setPosts((prev) => (prev.some((p) => p.id === newPost.id) ? prev : [newPost, ...prev]));
    };
    const handlePostUpdated = (e: Event) => {
      const detail = (e as CustomEvent<{ id: string; patch: Partial<Post> }>).detail;
      if (!detail?.id) return;
      setPosts((prev) => prev.map((p) => (p.id === detail.id ? { ...p, ...detail.patch } : p)));
      setSharedPost((prev) => (prev && prev.id === detail.id ? { ...prev, ...detail.patch } : prev));
    };
    const handlePostDeleted = (e: Event) => {
      const deletedId = (e as CustomEvent<string>).detail;
      if (!deletedId) return;
      setPosts((prev) => prev.filter((p) => p.id !== deletedId));
      setSharedPost((prev) => (prev && prev.id === deletedId ? null : prev));
    };
    const handleSpEarned = (e: Event) => {
      const d = (e as CustomEvent<{
        action: 'post' | 'comment' | 'repost' | 'quote' | 'story';
        baseActionSp: number;
        dailyBonus: number;
        totalEarned: number;
        isUltra: boolean;
      }>).detail;
      if (!d || !d.totalEarned) return;
      const actionLabels: Record<string, string> = {
        post: 'Post',
        comment: 'Comment',
        repost: 'Repost',
        quote: 'Quote',
        story: 'Story',
      };
      const label = actionLabels[d.action] || 'Action';
      const ultraSuffix = d.isUltra ? ' (2x Ultra)' : '';
      if (d.dailyBonus > 0) {
        showToast(`+${d.totalEarned} SP (+${d.baseActionSp} ${label} + ${d.dailyBonus} Daily Bonus${ultraSuffix})`);
      } else {
        showToast(`+${d.totalEarned} SP · ${label}${ultraSuffix}`);
      }
    };

    window.addEventListener('noir:search-tag', handleTagSearch);
    window.addEventListener('sync:profile-updated', handleProfileUpdated);
    window.addEventListener('sync:post-created', handlePostCreated);
    window.addEventListener('sync:post-updated', handlePostUpdated);
    window.addEventListener('sync:post-deleted', handlePostDeleted);
    window.addEventListener('sync:sp-earned', handleSpEarned);
    return () => {
      window.removeEventListener('noir:search-tag', handleTagSearch);
      window.removeEventListener('sync:profile-updated', handleProfileUpdated);
      window.removeEventListener('sync:post-created', handlePostCreated);
      window.removeEventListener('sync:post-updated', handlePostUpdated);
      window.removeEventListener('sync:post-deleted', handlePostDeleted);
      window.removeEventListener('sync:sp-earned', handleSpEarned);
    };
  }, [activeTagFilter, showToast]);

  const handleOpenProfile = (username: string) => {
    setActiveProfileUsername(username);
    setActiveTab('profile');
    window.history.pushState(null, '', `?u=${username}`);
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  const handleSelectTab = (tab: ActiveTab) => {
    setActiveTab(tab);
    if (tab !== 'profile') {
      setActiveProfileUsername(null);
    }
    if (tab !== 'messages') {
      setActiveChatRecipientId(null);
      setActiveChatConvId(null);
    }
    const newUrl = tab === 'home' ? '/' : `?tab=${tab}`;
    window.history.pushState(null, '', newUrl);
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  const handleOpenChatWithUser = (userId?: string | null, convId?: string | null) => {
    setActiveProfileUsername(null);
    setActiveChatRecipientId(userId || null);
    setActiveChatConvId(convId || null);
    setActiveTab('messages');
    window.history.pushState(null, '', '?tab=messages');
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  return (
    <div className="min-h-screen bg-black text-[#f5f5f7] flex relative selection:bg-white/20 selection:text-white">
      {/* Background ambient liquid illumination */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute top-[-15%] left-[20%] w-[550px] h-[550px] rounded-full bg-white/[0.025] blur-[140px]" />
        <div className="absolute bottom-[-10%] right-[10%] w-[500px] h-[500px] rounded-full bg-white/[0.02] blur-[160px]" />
      </div>

      {/* Navigation (Sidebar desktop, Bottom bar mobile) */}
      <Navigation
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
        onOpenCreatePost={() => setCreatePostModalOpen(true)}
        onOpenProfile={handleOpenProfile}
        onOpenInvite={() => setInviteModalOpen(true)}
        onOpenInstallApp={() => setInstallAppModalOpen(true)}
      />

      {/* Main Content Layout Container */}
      <div
        className={`flex-1 flex justify-center md:pl-64 lg:pl-72 ${
          activeTab === 'home' ? 'xl:pr-72 2xl:pr-80' : ''
        } ${
          activeTab === 'home' ||
          activeTab === 'explore' ||
          activeTab === 'leaderboard' ||
          activeTab === 'search' ||
          activeTab === 'notifications' ||
          activeTab === 'bookmarks' ||
          activeTab === 'settings'
            ? 'pt-[calc(3.125rem+env(safe-area-inset-top))]'
            : 'pt-[env(safe-area-inset-top)]'
        } ${!user && activeTab === 'home' ? 'md:pt-14' : 'md:pt-0'} z-10 w-full min-w-0`}
      >
        <main
          className={`w-full min-w-0 ${
            activeTab === 'messages'
              ? 'max-w-6xl px-2.5 sm:px-3 md:px-6 py-2.5 md:py-5 pb-[calc(4.75rem+env(safe-area-inset-bottom))] md:pb-5'
              : 'max-w-3xl px-3.5 sm:px-5 md:px-8 py-4 sm:py-6 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-12'
          }`}
        >
          <div>
            {/* ================= ACTIVE VIEW ROUTER ================= */}
              {activeTab === 'profile' && activeProfileUsername ? (
                <UserProfileView
              username={activeProfileUsername}
              onBack={() => {
                setActiveProfileUsername(null);
                setActiveTab('home');
                window.history.pushState(null, '', '/');
              }}
              onOpenProfile={handleOpenProfile}
              onOpenEditProfile={() => setEditProfileModalOpen(true)}
              onOpenLikedBy={(pId) => setLikedByModalPostId(pId)}
              onOpenReport={(pId) => setReportModalTargetId(pId)}
              onOpenFollowers={(u) => setFollowersModal({ username: u, type: 'followers' })}
              onOpenFollowing={(u) => setFollowersModal({ username: u, type: 'following' })}
              onOpenChat={handleOpenChatWithUser}
              onShareProfile={() => setInviteModalOpen(true)}
              onOpenAlerts={() => handleSelectTab('notifications')}
              unreadAlertsCount={counts.unreadNotifications}
              onOpenSaved={() => handleSelectTab('bookmarks')}
              onOpenSettings={() => handleSelectTab('settings')}
              onOpenLeaderboard={() => handleSelectTab('leaderboard')}
              onQuotePost={(p) => setQuoteTargetPost(p)}
              onRepostCreated={(newPost) =>
                setPosts((prev) => (prev.some((p) => p.id === newPost.id) ? prev : [newPost, ...prev]))
              }
              onOpenPost={(p) => setSharedPost(p)}
            />
          ) : activeTab === 'messages' ? (
            <ChatView
              key={user?.id || 'guest'}
              onOpenProfile={handleOpenProfile}
              initialRecipientId={activeChatRecipientId}
              initialConversationId={activeChatConvId}
              onOpenPostId={(postId) => {
                api.getPost(postId)
                  .then((res) => setSharedPost(res.post))
                  .catch(() => showToast('Post no longer available'));
              }}
            />
          ) : activeTab === 'leaderboard' ? (
            <LeaderboardView
              onOpenProfile={handleOpenProfile}
              onOpenCreatePost={() => {
                if (!user) openAuth('login');
                else setCreatePostModalOpen(true);
              }}
            />
          ) : activeTab === 'explore' || activeTab === 'search' ? (
            <ExploreView
              onOpenProfile={handleOpenProfile}
              onOpenLikedBy={(pId) => setLikedByModalPostId(pId)}
              onOpenReport={(pId) => setReportModalTargetId(pId)}
              initialTag={activeTagFilter}
              focusSearch={activeTab === 'search'}
              onOpenChat={handleOpenChatWithUser}
              onOpenInvite={() => setInviteModalOpen(true)}
              onQuotePost={(p) => setQuoteTargetPost(p)}
              onRepostCreated={(newPost) => setPosts((prev) => [newPost, ...prev])}
            />
          ) : activeTab === 'notifications' ? (
            <NotificationsView
              key={user?.id || 'guest'}
              onOpenProfile={handleOpenProfile}
              onOpenPost={(postId) => {
                api.getPost(postId)
                  .then((res) => setSharedPost(res.post))
                  .catch(() => {});
              }}
              onOpenMessages={(actorId, convId) => {
                handleOpenChatWithUser(actorId, convId);
              }}
              onOpenFollowingSection={(actorUsername) => {
                handleOpenProfile(actorUsername);
                setFollowersModal({ username: actorUsername, type: 'following' });
              }}
              onOpenFollowRequests={() => {
                handleSelectTab('settings');
              }}
            />
          ) : activeTab === 'bookmarks' ? (
            <BookmarksView
              key={user?.id || 'guest'}
              onOpenProfile={handleOpenProfile}
              onOpenLikedBy={(pId) => setLikedByModalPostId(pId)}
              onOpenReport={(pId) => setReportModalTargetId(pId)}
              onQuotePost={(p) => setQuoteTargetPost(p)}
              onRepostCreated={(newPost) => setPosts((prev) => [newPost, ...prev])}
            />
          ) : activeTab === 'settings' ? (
            <SettingsView
              key={user?.id || 'guest'}
              onOpenProfile={handleOpenProfile}
              onOpenInstallApp={() => setInstallAppModalOpen(true)}
              onOpenInvite={() => setInviteModalOpen(true)}
            />
          ) : (
            /* ================= HOME FEED ================= */
            <div>
              {/* Stories Carousel */}
              <StoriesBar
                onOpenProfile={handleOpenProfile}
                onOpenChat={handleOpenChatWithUser}
              />

              {/* Tag active filter banner */}
              {activeTagFilter && (
                <div className="mb-4 p-3 rounded-2xl glass-surface flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-400">Filtering tag:</span>
                    <span className="font-semibold text-white">#{activeTagFilter}</span>
                  </div>
                  <button
                    onClick={() => {
                      setActiveTagFilter(null);
                      window.history.pushState(null, '', '/');
                    }}
                    className="text-zinc-400 hover:text-white underline cursor-pointer"
                  >
                    Clear Filter
                  </button>
                </div>
              )}

              {/* Feed Header Tabs */}
              <div className="flex items-center justify-between mb-4 sm:mb-5 px-0.5 gap-2">
                <div className="flex items-center gap-0.5 sm:gap-1 p-1 rounded-2xl bg-white/[0.04] border border-white/10 text-xs relative">
                  {(['for_you', 'following', 'latest'] as const).map((type) => {
                    const isActive = feedType === type;
                    const label = type === 'for_you' ? 'For You' : type === 'following' ? 'Following' : 'Latest';
                    return (
                      <button
                        key={type}
                        onClick={() => {
                          soundFX.playTap();
                          if (type === 'following' && !user) openAuth('login');
                          else setFeedType(type);
                        }}
                        className="relative px-3 sm:px-4 py-1.5 min-h-[34px] rounded-xl text-xs font-semibold transition cursor-pointer select-none"
                      >
                        {isActive && (
                          <motion.div
                            layoutId="active-feed-pill"
                            className="absolute inset-0 bg-white rounded-xl shadow-[0_2px_12px_rgba(255,255,255,0.25)]"
                            transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                          />
                        )}
                        <span className={`relative z-10 transition-colors duration-200 ${isActive ? 'text-black font-semibold' : 'text-zinc-400 hover:text-white'}`}>
                          {label}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center gap-1.5 sm:gap-2">
                  <button
                    type="button"
                    onClick={() => setInviteModalOpen(true)}
                    className="hidden sm:flex items-center gap-1.5 px-3.5 min-h-[38px] rounded-xl glass-pill text-xs text-zinc-300 hover:text-white transition active:scale-95 cursor-pointer shadow-sm whitespace-nowrap"
                    title="Invite friends"
                  >
                    <UserPlus className="w-3.5 h-3.5 text-zinc-400" />
                    <span>Invite</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      soundFX.playTap();
                      fetchFeed();
                    }}
                    className="w-10 h-10 flex items-center justify-center rounded-xl text-zinc-400 hover:text-white hover:bg-white/5 transition active:scale-90 cursor-pointer"
                    title="Refresh Feed"
                    aria-label="Refresh feed"
                  >
                    <RefreshCw className={`w-4 h-4 ${loadingPosts ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              {/* Inline Create Post Box */}
              <CreatePostBox
                onPostCreated={(newPost) => {
                  setPosts((prev) => (prev.some((p) => p.id === newPost.id) ? prev : [newPost, ...prev]));
                }}
              />

              {/* Signed-out warning banner */}
              {!authLoading && !user && (
                <div className="mb-5 p-4 rounded-3xl glass-card border border-amber-500/25 bg-amber-500/[0.06] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs shadow-lg">
                  <div className="flex items-start sm:items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-amber-500/15 border border-amber-500/25 flex items-center justify-center shrink-0 text-amber-300">
                      <AlertTriangle className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-white">You are currently signed out</div>
                      <p className="text-zinc-300 leading-relaxed">
                        {!storagePersistent
                          ? 'Browser privacy settings are blocking local storage, so sessions cannot persist after closing the browser. Sign in with Google to restore your saved posts, comments, likes, and stories.'
                          : 'Sign in with Google to access your profile and save posts, comments, likes, and stories to your account.'}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => openAuth('login')}
                    className="glass-button-primary px-4 py-2 text-xs font-semibold shrink-0 self-end sm:self-center"
                  >
                    Sign In
                  </button>
                </div>
              )}

              {/* Inviter Greeting Banner */}
              {invitedByUsername && !user && (
                <div className="mb-5 p-4 rounded-3xl glass-card border border-white/20 flex items-center justify-between gap-3 text-xs shadow-lg">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center shrink-0 text-white">
                      <UserPlus className="w-4 h-4" />
                    </div>
                    <span className="text-zinc-300 truncate">
                      Invited by <strong className="text-white">@{invitedByUsername}</strong>. Join to connect and message in real-time.
                    </span>
                  </div>
                  <button
                    onClick={() => openAuth('register')}
                    className="glass-button-primary px-4 py-2 text-xs font-semibold shrink-0"
                  >
                    Join to Connect
                  </button>
                </div>
              )}

              {/* Posts Feed Stream */}
              {loadingPosts && posts.length === 0 ? (
                <div className="flex flex-col gap-5">
                  {[0, 1].map((idx) => (
                    <div
                      key={idx}
                      className="glass-card rounded-3xl p-5 md:p-6 border border-white/[0.08] animate-pulse"
                    >
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-full bg-white/[0.08]" />
                        <div className="space-y-2 flex-1">
                          <div className="h-3 w-32 rounded-full bg-white/[0.08]" />
                          <div className="h-2.5 w-20 rounded-full bg-white/[0.05]" />
                        </div>
                      </div>
                      <div className="space-y-2 mb-4">
                        <div className="h-3 w-full rounded-full bg-white/[0.06]" />
                        <div className="h-3 w-4/5 rounded-full bg-white/[0.05]" />
                      </div>
                      <div className="h-44 w-full rounded-2xl bg-white/[0.05]" />
                    </div>
                  ))}
                </div>
              ) : posts.length === 0 ? (
                <div className="glass-card rounded-3xl p-8 md:p-10 text-center border border-white/10">
                  <div className="w-11 h-11 rounded-2xl bg-white/[0.06] border border-white/15 flex items-center justify-center mx-auto mb-3.5 text-white">
                    <Plus className="w-5 h-5" />
                  </div>
                  <h3 className="text-base md:text-lg font-semibold text-white mb-1.5">
                    {feedType === 'following' ? 'No posts from followed accounts' : 'Be the first to post'}
                  </h3>
                  <p className="text-xs text-zinc-400 max-w-sm mx-auto mb-5 leading-relaxed">
                    {feedType === 'following'
                      ? 'Follow people you know or switch back to the main feed to see new posts.'
                      : 'Share a photograph, thought, or update to kick off the conversation.'}
                  </p>
                  <div className="flex items-center justify-center gap-3 flex-wrap">
                    <button
                      type="button"
                      onClick={() => {
                        if (!user) openAuth('login');
                        else setCreatePostModalOpen(true);
                      }}
                      className="glass-button-primary px-5 min-h-[40px] text-xs font-semibold flex items-center gap-1.5 cursor-pointer active:scale-95 transition"
                    >
                      <Plus className="w-4 h-4 stroke-[2.5]" />
                      <span>Create Post</span>
                    </button>
                    {feedType === 'following' ? (
                      <button
                        type="button"
                        onClick={() => setFeedType('for_you')}
                        className="px-4 min-h-[40px] rounded-2xl border border-white/15 text-xs font-semibold text-zinc-300 hover:text-white hover:bg-white/5 transition cursor-pointer"
                      >
                        Back to For You
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={fetchFeed}
                        className="px-4 min-h-[40px] rounded-2xl border border-white/15 text-xs font-semibold text-zinc-300 hover:text-white hover:bg-white/5 transition flex items-center gap-1.5 cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Refresh</span>
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col">
                  {posts.map((post, idx) => (
                    <PostCard
                      key={post.id}
                      post={post}
                      priorityImage={idx < 2}
                      onOpenProfile={handleOpenProfile}
                      onOpenLikedBy={(pId) => setLikedByModalPostId(pId)}
                      onOpenReport={(pId) => setReportModalTargetId(pId)}
                      onQuotePost={(p) => setQuoteTargetPost(p)}
                      onRepostCreated={(newPost) =>
                        setPosts((prev) => (prev.some((p) => p.id === newPost.id) ? prev : [newPost, ...prev]))
                      }
                      onPostUpdated={(updated) => {
                        setPosts((prev) =>
                          prev.map((p) => (p.id === post.id ? { ...p, ...updated } : p))
                        );
                      }}
                      onPostDeleted={(postId) => {
                        setPosts((prev) => prev.filter((p) => p.id !== postId));
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
          </div>
        </main>
      </div>

      {/* Compact Right-Side SP Leaderboard Sidebar (Desktop xl+) */}
      <RightLeaderboardSidebar
        activeTab={activeTab}
        onOpenProfile={handleOpenProfile}
        onOpenLeaderboard={() => handleSelectTab('leaderboard')}
        onOpenCreatePost={() => {
          if (!user) openAuth('login');
          else setCreatePostModalOpen(true);
        }}
      />

      {/* ================= MODALS & OVERLAYS ================= */}
      <AuthModal />
      <SignOutConfirmModal />
      <AccountSwitcherModal />

      {(createPostModalOpen || quoteTargetPost) && (
        <CreatePostBox
          isModal
          quotePost={quoteTargetPost}
          onClose={() => {
            setCreatePostModalOpen(false);
            setQuoteTargetPost(null);
          }}
          onPostCreated={(post) => {
            setPosts((prev) => (prev.some((p) => p.id === post.id) ? prev : [post, ...prev]));
            setCreatePostModalOpen(false);
            setQuoteTargetPost(null);
          }}
        />
      )}

      {editProfileModalOpen && (
        <EditProfileModal onClose={() => setEditProfileModalOpen(false)} />
      )}

      {inviteModalOpen && (
        <InviteModal onClose={() => setInviteModalOpen(false)} />
      )}

      <InstallAppModal
        isOpen={installAppModalOpen}
        onClose={() => setInstallAppModalOpen(false)}
      />

      {followersModal && (
        <FollowersModal
          username={followersModal.username}
          type={followersModal.type}
          onClose={() => setFollowersModal(null)}
          onOpenProfile={handleOpenProfile}
        />
      )}

      {likedByModalPostId && (
        <LikedByModal
          postId={likedByModalPostId}
          onClose={() => setLikedByModalPostId(null)}
          onOpenProfile={handleOpenProfile}
        />
      )}

      {reportModalTargetId && (
        <ReportModal
          targetId={reportModalTargetId}
          onClose={() => setReportModalTargetId(null)}
        />
      )}

      {sharedPost && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setSharedPost(null);
              window.history.replaceState(null, '', '/');
            }
          }}
          className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-xl flex items-center justify-center p-4"
        >
          <div className="w-full max-w-xl max-h-[90dvh] overflow-y-auto relative">
            <div className="flex items-center justify-between mb-3 px-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Shared Post
              </span>
              <button
                type="button"
                onClick={() => {
                  setSharedPost(null);
                  window.history.replaceState(null, '', '/');
                }}
                className="w-10 h-10 flex items-center justify-center rounded-full bg-white/10 text-zinc-300 hover:text-white hover:bg-white/20 transition cursor-pointer"
                aria-label="Close shared post"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <PostCard
              post={sharedPost}
              onOpenProfile={(u) => {
                setSharedPost(null);
                handleOpenProfile(u);
              }}
              onOpenLikedBy={(pId) => setLikedByModalPostId(pId)}
              onOpenReport={(pId) => setReportModalTargetId(pId)}
              onQuotePost={(p) => {
                setSharedPost(null);
                setQuoteTargetPost(p);
              }}
              onRepostCreated={(newPost) => setPosts((prev) => [newPost, ...prev])}
              onPostUpdated={(updated) => {
                setSharedPost((prev) => (prev ? { ...prev, ...updated } : null));
                setPosts((prev) =>
                  prev.map((p) => (p.id === sharedPost.id ? { ...p, ...updated } : p))
                );
              }}
              onPostDeleted={(postId) => {
                setSharedPost(null);
                setPosts((prev) => prev.filter((p) => p.id !== postId));
                window.history.replaceState(null, '', '/');
              }}
            />
          </div>
        </div>
      )}

      {/* Liquid Toast Banner */}
      <AnimatePresence>
        {activeToast && (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] md:bottom-8 left-1/2 -translate-x-1/2 z-[120] glass-surface px-4 sm:px-5 py-2.5 sm:py-3 rounded-full text-xs font-medium text-white border border-white/20 shadow-2xl flex items-center gap-2 max-w-[90vw]"
          >
            <Sparkles className="w-3.5 h-3.5 text-zinc-200 shrink-0" />
            <span className="truncate">{activeToast}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function App() {
  return (
    <AppErrorBoundary>
      <AuthProvider>
        <NoirMain />
      </AuthProvider>
    </AppErrorBoundary>
  );
}
