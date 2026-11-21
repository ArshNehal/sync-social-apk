import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  Plus,
  X,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Upload,
  Tag,
  Eye,
  Send,
  Star,
  BookmarkPlus,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { StoryGroup, StoryHighlight, StoryViewer, User } from '../types';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Avatar, useUserPresence } from './Avatar';
import { CloseFriendsModal, WarningPopup } from './Modals';
import { soundFX } from '../lib/sounds';

const STORY_DURATION_MS = 5000;
const QUICK_REACTIONS = ['🔥', '❤️', '🙌', '😮', '👏', '✨'];

const StoryRingItem: React.FC<{
  group: StoryGroup;
  isMe: boolean;
  onOpen: () => void;
}> = ({ group, isMe, onOpen }) => {
  const isOnline = useUserPresence(group.userId);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex flex-col items-center gap-1.5 shrink-0 cursor-pointer group select-none transition-transform duration-150 md:hover:scale-105 active:scale-95"
    >
      <div className="relative">
        <div
          className={`w-15 h-15 sm:w-16 sm:h-16 rounded-full p-[2px] transition-colors duration-200 ${
            group.hasUnviewed
              ? group.hasCloseFriends
                ? 'bg-gradient-to-tr from-emerald-400 via-green-400 to-emerald-500 shadow-[0_0_14px_rgba(52,211,153,0.38)]'
                : 'bg-gradient-to-tr from-white via-zinc-200 to-zinc-400 shadow-[0_0_14px_rgba(255,255,255,0.22)]'
              : 'border border-white/20 opacity-80'
          }`}
        >
          <div className="w-full h-full rounded-full overflow-hidden p-[2px] bg-black flex items-center justify-center">
            <Avatar
              showPresence={false}
              name={group.displayName}
              url={group.avatarUrl}
              size="md"
              className="w-full h-full"
            />
          </div>
        </div>
        {isOnline && (
          <span
            title="Online"
            aria-label="Online"
            className="absolute bottom-0.5 right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-400 ring-2 ring-black shadow-[0_0_8px_rgba(52,211,153,0.75)] pointer-events-none"
          />
        )}
      </div>
      <span className="text-[11px] font-medium text-zinc-300 group-hover:text-white max-w-[68px] truncate">
        {isMe ? 'You' : group.displayName.split(' ')[0]}
      </span>
    </button>
  );
};

export const StoriesBar: React.FC<{
  onRefreshFeed?: () => void;
  onOpenProfile?: (username: string) => void;
  onOpenChat?: (userId: string) => void;
}> = ({ onOpenProfile }) => {
  const { user, authConfirmedUid, openAuth, showToast } = useAuth();
  const [storyGroups, setStoryGroups] = useState<StoryGroup[]>(() => api.getCachedStories() || []);
  const [loadingStories, setLoadingStories] = useState<boolean>(() => {
    const cached = api.getCachedStories();
    return !cached || cached.length === 0;
  });
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [activeStoryIndex, setActiveStoryIndex] = useState(0);
  const [createModalOpen, setCreateModalOpen] = useState(false);

  // Synchronously reflect any live PFP / display name edits on story rings & viewer
  const liveStoryGroups = useMemo(() => {
    if (!user) return storyGroups;
    return storyGroups.map((g) =>
      g.userId === user.id
        ? {
            ...g,
            avatarUrl: user.avatar_url || '',
            displayName: user.display_name,
            username: user.username,
            isVerified: !!user.is_verified,
          }
        : g
    );
  }, [storyGroups, user?.id, user?.avatar_url, user?.display_name, user?.username, user?.is_verified]);

  const activeViewerGroup = activeGroupId
    ? liveStoryGroups.find((g) => g.userId === activeGroupId) || null
    : null;

  const syncViewedBackground = useCallback(
    (groups: StoryGroup[]) => {
      const allIds = groups.flatMap((g) => g.stories.map((s) => s.id));
      if (allIds.length > 0 && user?.id) {
        api
          .syncStoryViewsBackground(allIds)
          .then((newlyViewed) => {
            if (newlyViewed.size > 0) {
              setStoryGroups((prev) =>
                prev.map((g) => {
                  const updated = g.stories.map((s) =>
                    newlyViewed.has(s.id) ? { ...s, isViewed: true } : s
                  );
                  return {
                    ...g,
                    stories: updated,
                    hasUnviewed: updated.some((s) => !s.isViewed),
                  };
                })
              );
            }
          })
          .catch(() => {});
      }
    },
    [user?.id]
  );

  const fetchStories = useCallback(async () => {
    try {
      const res = await api.getStories();
      setStoryGroups(res.storyGroups);
      syncViewedBackground(res.storyGroups);
    } catch {
      // Keep cached stories if offline
    } finally {
      setLoadingStories(false);
    }
  }, [syncViewedBackground]);

  useEffect(() => {
    const unsubscribe = api.subscribeStories((liveGroups) => {
      setStoryGroups(liveGroups);
      setLoadingStories(false);
      syncViewedBackground(liveGroups);
    });

    const safetyTimer = setTimeout(() => setLoadingStories(false), 3000);
    return () => {
      clearTimeout(safetyTimer);
      unsubscribe();
    };
  }, [authConfirmedUid, syncViewedBackground]);

  useEffect(() => {
    const onProfileUpdated = () => {
      const cached = api.getCachedStories();
      if (cached) setStoryGroups(cached);
    };
    window.addEventListener('sync:profile-updated', onProfileUpdated);
    return () => window.removeEventListener('sync:profile-updated', onProfileUpdated);
  }, []);

  const handleMarkViewed = useCallback(
    (
      groupUserId: string,
      storyId: string,
      expiresAt?: string,
      audience?: 'everyone' | 'close_friends'
    ) => {
      if (user?.id) {
        api.viewStory(storyId, expiresAt, audience).catch(() => {});
      }
      setStoryGroups((prev) =>
        prev.map((g) => {
          if (g.userId !== groupUserId) return g;
          let changed = false;
          const nextStories = g.stories.map((s) => {
            if (s.id === storyId && !s.isViewed) {
              changed = true;
              return { ...s, isViewed: true };
            }
            return s;
          });
          if (!changed) return g;
          return {
            ...g,
            stories: nextStories,
            hasUnviewed: nextStories.some((s) => !s.isViewed),
          };
        })
      );
    },
    [user?.id]
  );

  const handleOpenGroup = (group: StoryGroup) => {
    soundFX.playTap();
    const unviewedIdx = group.stories.findIndex((s) => !s.isViewed);
    setActiveGroupId(group.userId);
    setActiveStoryIndex(unviewedIdx !== -1 ? unviewedIdx : 0);
  };

  const handleNextStory = useCallback(() => {
    if (!activeViewerGroup) return;
    if (activeStoryIndex < activeViewerGroup.stories.length - 1) {
      setActiveStoryIndex((i) => i + 1);
    } else {
      const currentGroupIndex = liveStoryGroups.findIndex(
        (g) => g.userId === activeViewerGroup.userId
      );
      if (currentGroupIndex !== -1 && currentGroupIndex < liveStoryGroups.length - 1) {
        const nextGroup = liveStoryGroups[currentGroupIndex + 1];
        setActiveGroupId(nextGroup.userId);
        const nextUnviewed = nextGroup.stories.findIndex((s) => !s.isViewed);
        setActiveStoryIndex(nextUnviewed !== -1 ? nextUnviewed : 0);
      } else {
        setActiveGroupId(null);
      }
    }
  }, [activeViewerGroup, activeStoryIndex, liveStoryGroups]);

  const handlePrevStory = useCallback(() => {
    if (!activeViewerGroup) return;
    if (activeStoryIndex > 0) {
      setActiveStoryIndex((i) => i - 1);
    } else {
      const currentGroupIndex = liveStoryGroups.findIndex(
        (g) => g.userId === activeViewerGroup.userId
      );
      if (currentGroupIndex > 0) {
        const prevGroup = liveStoryGroups[currentGroupIndex - 1];
        setActiveGroupId(prevGroup.userId);
        setActiveStoryIndex(Math.max(0, prevGroup.stories.length - 1));
      }
    }
  }, [activeViewerGroup, activeStoryIndex, liveStoryGroups]);

  const handleDeleteStory = async (storyId: string, audience?: 'everyone' | 'close_friends') => {
    if (!storyId) return;
    try {
      await api.deleteStory(storyId, audience);
      showToast('Story deleted');
      setActiveGroupId(null);
      fetchStories();
    } catch (err: any) {
      showToast(err.message || 'Failed to delete story');
    }
  };

  return (
    <>
      <div className="glass-card rounded-2xl p-3.5 sm:p-4 mb-5 border border-white/[0.08] relative overflow-hidden">
        <div className="flex items-center gap-3.5 sm:gap-4 overflow-x-auto no-scrollbar py-1">
          {/* Add story button (strictly no online green dot here) */}
          <button
            type="button"
            onClick={() => {
              if (!user) openAuth('login');
              else setCreateModalOpen(true);
            }}
            className="flex flex-col items-center gap-1.5 shrink-0 cursor-pointer group transition-transform duration-150 md:hover:scale-105 active:scale-95"
          >
            <div className="relative">
              <div className="relative w-15 h-15 sm:w-16 sm:h-16 rounded-full p-0.5 border-2 border-dashed border-white/25 group-hover:border-white transition-colors flex items-center justify-center bg-black/40">
                <div className="w-full h-full rounded-full overflow-hidden relative flex items-center justify-center bg-zinc-900">
                  <Avatar
                    showPresence={false}
                    name={user?.display_name || 'You'}
                    url={user?.avatar_url}
                    size="md"
                    className="w-full h-full"
                  />
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                    <div className="w-6 h-6 rounded-full bg-white text-black flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                      <Plus className="w-4 h-4 stroke-[2.5]" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <span className="text-[11px] font-medium text-zinc-400 group-hover:text-zinc-200">
              Your Story
            </span>
          </button>

          {/* Fast Skeletons only during very first cold load */}
          {loadingStories && liveStoryGroups.length === 0 && (
            <>
              {[0, 1, 2, 3].map((idx) => (
                <div key={idx} className="flex flex-col items-center gap-1.5 shrink-0 animate-pulse">
                  <div className="w-15 h-15 sm:w-16 sm:h-16 rounded-full bg-white/[0.06] border border-white/10" />
                  <div className="w-11 h-2.5 rounded-full bg-white/[0.06]" />
                </div>
              ))}
            </>
          )}

          {/* User Stories list */}
          {liveStoryGroups.map((group) => (
            <StoryRingItem
              key={group.userId}
              group={group}
              isMe={group.userId === user?.id}
              onOpen={() => handleOpenGroup(group)}
            />
          ))}
        </div>
      </div>

      {/* ================= STORY VIEWER MODAL ================= */}
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {activeViewerGroup && (
              <StoryViewerModal
                group={activeViewerGroup}
                storyIndex={activeStoryIndex}
                canDelete={!!(user && activeViewerGroup.userId === user.id)}
                onClose={() => setActiveGroupId(null)}
                onNext={handleNextStory}
                onPrev={handlePrevStory}
                onDelete={handleDeleteStory}
                onMarkViewed={handleMarkViewed}
                onOpenProfile={onOpenProfile}
              />
            )}
          </AnimatePresence>,
          document.body
        )}

      {/* ================= CREATE STORY MODAL ================= */}
      {createModalOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <CreateStoryModal
            onClose={() => setCreateModalOpen(false)}
            onSuccess={() => {
              setCreateModalOpen(false);
              fetchStories();
            }}
          />,
          document.body
        )}
    </>
  );
};

export interface StoryViewerModalProps {
  group: StoryGroup;
  storyIndex: number;
  canDelete: boolean;
  isHighlightMode?: boolean;
  highlightTitle?: string;
  onDeleteHighlight?: () => void;
  onClose: () => void;
  onNext: () => void;
  onPrev: () => void;
  onDelete: (storyId: string, audience?: 'everyone' | 'close_friends') => void;
  onMarkViewed: (
    groupUserId: string,
    storyId: string,
    expiresAt?: string,
    audience?: 'everyone' | 'close_friends'
  ) => void;
  onOpenProfile?: (username: string) => void;
}

export const StoryViewerModal: React.FC<StoryViewerModalProps> = ({
  group,
  storyIndex,
  canDelete,
  isHighlightMode = false,
  highlightTitle,
  onDeleteHighlight,
  onClose,
  onNext,
  onPrev,
  onDelete,
  onMarkViewed,
  onOpenProfile,
}) => {
  const { user, openAuth, showToast } = useAuth();
  const [isPaused, setIsPaused] = useState(false);
  const [isTypingReply, setIsTypingReply] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const [viewsCount, setViewsCount] = useState<number | null>(null);
  const [viewersModalOpen, setViewersModalOpen] = useState(false);
  const [viewers, setViewers] = useState<StoryViewer[]>([]);
  const [loadingViewers, setLoadingViewers] = useState(false);
  const [highlightSheetOpen, setHighlightSheetOpen] = useState(false);
  const [userHighlights, setUserHighlights] = useState<StoryHighlight[]>([]);
  const [newHighlightTitle, setNewHighlightTitle] = useState('');
  const [savingHighlight, setSavingHighlight] = useState(false);
  const [imageLoading, setImageLoading] = useState(true);
  const [imageError, setImageError] = useState(false);
  const [confirmDeleteType, setConfirmDeleteType] = useState<'story' | 'highlight' | null>(null);
  const [deletingItem, setDeletingItem] = useState(false);
  const [progress, setProgress] = useState(0);
  const holdStartRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);
  const elapsedRef = useRef<number>(0);
  const lastTickRef = useRef<number>(0);
  const currentStory = group.stories[storyIndex] || group.stories[0];

  const nextStory = group.stories[storyIndex + 1];

  // Mark story viewed immediately, fetch views count for own story, preload next slide
  useEffect(() => {
    elapsedRef.current = 0;
    setProgress(0);
    setViewsCount(null);
    setImageLoading(Boolean(currentStory?.imageUrl));
    setImageError(false);
    if (!isHighlightMode && currentStory && !currentStory.isViewed) {
      onMarkViewed(group.userId, currentStory.id, currentStory.expiresAt, currentStory.audience);
    }
    if (!isHighlightMode && canDelete && currentStory) {
      api.getStoryViewsCount(currentStory.id, currentStory.audience)
        .then((cnt) => setViewsCount(cnt))
        .catch(() => {});
    }
    if (nextStory?.imageUrl) {
      const preload = new Image();
      preload.src = nextStory.imageUrl;
    }
  }, [
    group.userId,
    canDelete,
    isHighlightMode,
    currentStory?.id,
    currentStory?.isViewed,
    currentStory?.expiresAt,
    currentStory?.audience,
    currentStory?.imageUrl,
    nextStory?.imageUrl,
    onMarkViewed,
  ]);

  // Smooth requestAnimationFrame story timer
  useEffect(() => {
    if (!currentStory || isPaused || isTypingReply || viewersModalOpen || highlightSheetOpen || imageLoading || !!confirmDeleteType) {
      lastTickRef.current = 0;
      return;
    }

    const tick = (now: number) => {
      if (!lastTickRef.current) {
        lastTickRef.current = now;
      }
      const delta = now - lastTickRef.current;
      lastTickRef.current = now;
      elapsedRef.current += delta;

      const pct = Math.min(100, (elapsedRef.current / STORY_DURATION_MS) * 100);
      setProgress(pct);

      if (elapsedRef.current >= STORY_DURATION_MS) {
        onNext();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [currentStory?.id, isPaused, isTypingReply, viewersModalOpen, highlightSheetOpen, imageLoading, confirmDeleteType, onNext]);

  // Keyboard navigation
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingReply || confirmDeleteType) return;
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') onNext();
      else if (e.key === 'ArrowLeft') onPrev();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, onNext, onPrev, isTypingReply, confirmDeleteType]);

  const handlePressStart = () => {
    holdStartRef.current = Date.now();
    setIsPaused(true);
  };

  const handlePressEnd = () => {
    setIsPaused(false);
  };

  const isTapQuick = () => Date.now() - holdStartRef.current < 260;

  const handleSendReply = async (textToSend: string) => {
    const trimmed = textToSend.trim();
    if (!trimmed || sendingReply) return;
    if (!user) {
      onClose();
      openAuth('login');
      return;
    }
    setSendingReply(true);
    try {
      await api.replyToStory(group.userId, currentStory?.caption || '', trimmed);
      soundFX.playMessageSent();
      setReplyText('');
      setIsTypingReply(false);
      showToast(`Sent to @${group.username}`);
    } catch {
      showToast('Could not send story reply');
    } finally {
      setSendingReply(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[110] bg-black/95 backdrop-blur-2xl flex items-center justify-center p-0 md:p-6 select-none"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Desktop Left/Right navigation buttons */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onPrev();
        }}
        className="hidden md:flex absolute left-6 lg:left-10 top-1/2 -translate-y-1/2 z-40 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition cursor-pointer"
        aria-label="Previous story"
      >
        <ChevronLeft className="w-6 h-6" />
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onNext();
        }}
        className="hidden md:flex absolute right-6 lg:right-10 top-1/2 -translate-y-1/2 z-40 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition cursor-pointer"
        aria-label="Next story"
      >
        <ChevronRight className="w-6 h-6" />
      </button>

      {/* Story Container */}
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        transition={{ duration: 0.18 }}
        onPointerDown={handlePressStart}
        onPointerUp={handlePressEnd}
        onPointerCancel={handlePressEnd}
        onPointerLeave={handlePressEnd}
        className="relative w-full max-w-sm h-[100dvh] md:h-[84vh] md:rounded-3xl overflow-hidden bg-zinc-950 flex flex-col justify-between border-0 md:border md:border-white/15 shadow-2xl"
      >
        {/* Top gradient scrim for legibility */}
        <div className="pointer-events-none absolute top-0 inset-x-0 h-28 bg-gradient-to-b from-black/80 via-black/40 to-transparent z-20" />
        {/* Bottom gradient scrim for caption / tags / replies */}
        <div className="pointer-events-none absolute bottom-0 inset-x-0 h-44 bg-gradient-to-t from-black/90 via-black/45 to-transparent z-20" />

        {/* Unified Top Progress Bars + Author & Action Controls */}
        <div
          className="absolute top-0 inset-x-0 z-30 px-3 sm:px-4 pt-[max(0.75rem,env(safe-area-inset-top))]"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {/* Progress Bars */}
          <div className="flex items-center gap-1.5 mb-3">
            {group.stories.map((s, idx) => {
              let barWidth = '0%';
              if (idx < storyIndex) barWidth = '100%';
              else if (idx === storyIndex) barWidth = `${progress}%`;

              return (
                <div
                  key={s.id}
                  className="flex-1 h-1 bg-white/25 rounded-full overflow-hidden"
                >
                  <div
                    className="h-full bg-white"
                    style={{ width: barWidth }}
                  />
                </div>
              );
            })}
          </div>

          {/* Author & Controls row */}
          <div className="flex items-center justify-between gap-2 text-white">
            <button
              type="button"
              onClick={() => {
                if (onOpenProfile) {
                  onClose();
                  onOpenProfile(group.username);
                }
              }}
              className="flex items-center gap-2.5 min-w-0 text-left cursor-pointer"
            >
              <Avatar
                userId={group.userId}
                name={group.displayName}
                url={group.avatarUrl}
                size="sm"
              />
              <div className="min-w-0">
                <div className="text-xs font-semibold flex items-center gap-1 truncate">
                  <span className="truncate">{group.displayName}</span>
                  {group.isVerified && (
                    <Sparkles className="w-3 h-3 text-zinc-300 shrink-0" />
                  )}
                </div>
                <div className="text-[10px] text-zinc-300/80 font-mono truncate flex items-center gap-1.5">
                  <span>@{group.username}</span>
                  {isHighlightMode && highlightTitle && (
                    <span className="px-1.5 py-0.5 rounded-full bg-white/15 text-white font-sans font-semibold text-[9px] truncate">
                      {highlightTitle}
                    </span>
                  )}
                  {!isHighlightMode && currentStory?.audience === 'close_friends' && (
                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-emerald-500/25 border border-emerald-400/40 text-emerald-300 font-sans font-semibold text-[9px]">
                      <Star className="w-2.5 h-2.5 fill-emerald-400" />
                      <span>Close Friends</span>
                    </span>
                  )}
                </div>
              </div>
            </button>

            <div className="flex items-center gap-1.5 shrink-0">
              {isHighlightMode && canDelete && onDeleteHighlight && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmDeleteType('highlight');
                  }}
                  className="w-11 h-11 flex items-center justify-center rounded-full bg-black/50 hover:bg-red-500/85 text-white transition cursor-pointer"
                  title="Delete highlight"
                  aria-label="Delete highlight"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
              {!isHighlightMode && canDelete && currentStory && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmDeleteType('story');
                  }}
                  className="w-11 h-11 flex items-center justify-center rounded-full bg-black/50 hover:bg-red-500/85 text-white transition cursor-pointer"
                  title="Delete story"
                  aria-label="Delete story"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
              {isPaused && (
                <span className="px-2 py-0.5 rounded-full bg-black/60 border border-white/15 text-[10px] font-medium text-zinc-200">
                  Paused
                </span>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose();
                }}
                className="w-11 h-11 flex items-center justify-center rounded-full bg-black/50 hover:bg-white/20 text-white transition cursor-pointer"
                title="Close story"
                aria-label="Close story"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        {/* Story image */}
        <div className="relative w-full h-full flex items-center justify-center bg-black">
          {currentStory && (
            imageError ? (
              <div className="flex flex-col items-center justify-center gap-2 text-zinc-500 text-xs px-6 text-center">
                <span>Story image unavailable</span>
              </div>
            ) : (
              <>
                {imageLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-zinc-950 z-10 pointer-events-none">
                    <div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-white animate-spin" />
                  </div>
                )}
                <img
                  src={currentStory.imageUrl}
                  alt="Story"
                  referrerPolicy="no-referrer"
                  onLoad={() => setImageLoading(false)}
                  onError={() => {
                    setImageLoading(false);
                    setImageError(true);
                  }}
                  className="w-full h-full object-cover"
                  draggable={false}
                />
              </>
            )
          )}

          {/* Touch split tap areas */}
          <div
            className="absolute inset-y-0 left-0 w-1/3 z-10"
            onClick={(e) => {
              e.stopPropagation();
              if (isTapQuick()) onPrev();
            }}
          />
          <div
            className="absolute inset-y-0 right-0 w-2/3 z-10"
            onClick={(e) => {
              e.stopPropagation();
              if (isTapQuick()) onNext();
            }}
          />
        </div>

        {/* Bottom Overlay: Tags + Caption + Owner Views OR Viewer Quick Reactions & DM Reply */}
        <div
          className="absolute bottom-[max(1rem,env(safe-area-inset-bottom))] inset-x-3.5 z-30 flex flex-col gap-2"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {/* Clickable Story Tags */}
          {currentStory?.tags && currentStory.tags.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              {currentStory.tags.map((tag) => {
                const isMention = tag.startsWith('@');
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => {
                      soundFX.playTap();
                      if (isMention && onOpenProfile) {
                        onClose();
                        onOpenProfile(tag.slice(1));
                      } else {
                        const cleanTag = tag.startsWith('#') ? tag.slice(1) : tag;
                        onClose();
                        window.dispatchEvent(new CustomEvent('noir:search-tag', { detail: cleanTag }));
                      }
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-black/65 backdrop-blur-md border border-white/20 text-[11px] font-semibold text-white hover:bg-white/20 transition cursor-pointer"
                  >
                    <Tag className="w-2.5 h-2.5 text-zinc-300" />
                    <span>{tag}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Story Caption */}
          {currentStory?.caption && (
            <div className="p-2.5 rounded-2xl glass-surface text-center text-xs text-white pointer-events-none">
              {currentStory.caption}
            </div>
          )}

          {/* Owner Views Count + Highlight OR Viewer Reactions + Reply */}
          {isHighlightMode ? (
            <div className="flex items-center justify-center">
              <span className="px-3 py-1 rounded-full bg-black/60 border border-white/10 text-[11px] text-zinc-300">
                Highlight · {highlightTitle || 'Memories'}
              </span>
            </div>
          ) : canDelete ? (
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  if (!currentStory) return;
                  soundFX.playTap();
                  setViewersModalOpen(true);
                  setLoadingViewers(true);
                  try {
                    const res = await api.getStoryViewers(currentStory.id, currentStory.audience);
                    setViewers(res.viewers);
                    setViewsCount(res.viewers.length);
                  } catch {
                    showToast('Could not load viewers');
                  } finally {
                    setLoadingViewers(false);
                  }
                }}
                className="inline-flex items-center gap-1.5 px-3.5 min-h-[38px] rounded-full bg-black/70 hover:bg-white/15 backdrop-blur-md border border-white/15 text-xs font-medium text-zinc-200 tabular-nums transition cursor-pointer"
              >
                <Eye className="w-3.5 h-3.5 text-zinc-300" />
                <span>{viewsCount === null ? '...' : `${viewsCount} ${viewsCount === 1 ? 'view' : 'views'}`}</span>
              </button>

              {currentStory && (
                <button
                  type="button"
                  onClick={async () => {
                    if (!user) return;
                    soundFX.playTap();
                    setHighlightSheetOpen(true);
                    try {
                      const res = await api.getUserHighlights(user.id);
                      setUserHighlights(res.highlights);
                    } catch {}
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 min-h-[38px] rounded-full bg-black/70 hover:bg-white/15 backdrop-blur-md border border-white/15 text-xs font-medium text-white transition cursor-pointer"
                >
                  <BookmarkPlus className="w-3.5 h-3.5" />
                  <span>Highlight</span>
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-center gap-1.5">
                {QUICK_REACTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    disabled={sendingReply}
                    onClick={() => handleSendReply(emoji)}
                    className="w-9 h-9 rounded-full bg-black/55 hover:bg-white/20 border border-white/15 flex items-center justify-center text-base transition active:scale-90 cursor-pointer"
                    aria-label={`React ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendReply(replyText);
                }}
                className="flex items-center gap-2"
              >
                <input
                  type="text"
                  value={replyText}
                  onFocus={() => setIsTypingReply(true)}
                  onBlur={() => setIsTypingReply(false)}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder={`Reply to @${group.username}...`}
                  className="flex-1 h-10 px-4 rounded-full bg-black/65 backdrop-blur-md border border-white/20 text-xs text-white placeholder-zinc-400 outline-none focus:border-white/50"
                />
                {replyText.trim() && (
                  <button
                    type="submit"
                    disabled={sendingReply}
                    aria-label="Send story reply"
                    className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center shrink-0 cursor-pointer active:scale-90 transition disabled:opacity-50"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                )}
              </form>
            </div>
          )}
        </div>

        {/* Story Viewers Sheet Overlay */}
        <AnimatePresence>
          {viewersModalOpen && (
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ duration: 0.2 }}
              onPointerDown={(e) => e.stopPropagation()}
              className="absolute inset-x-0 bottom-0 max-h-[65%] bg-zinc-950/95 backdrop-blur-xl border-t border-white/15 rounded-t-3xl z-40 flex flex-col p-4"
            >
              <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-white">
                  <Eye className="w-4 h-4 text-zinc-300" />
                  <span className="tabular-nums">Viewers ({viewers.length})</span>
                </div>
                <button
                  type="button"
                  onClick={() => setViewersModalOpen(false)}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
                {loadingViewers ? (
                  <p className="text-xs text-zinc-500 text-center py-6">Loading viewers...</p>
                ) : viewers.length === 0 ? (
                  <p className="text-xs text-zinc-500 text-center py-6">No one has viewed this story yet.</p>
                ) : (
                  viewers.map((v) => (
                    <div
                      key={v.user.id}
                      onClick={() => {
                        if (onOpenProfile) {
                          setViewersModalOpen(false);
                          onClose();
                          onOpenProfile(v.user.username);
                        }
                      }}
                      className="flex items-center justify-between gap-2.5 p-2 rounded-2xl hover:bg-white/[0.06] cursor-pointer transition"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Avatar
                          userId={v.user.id}
                          name={v.user.display_name}
                          url={v.user.avatar_url}
                          size="sm"
                        />
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-white truncate">{v.user.display_name}</div>
                          <div className="text-[10px] text-zinc-500 font-mono truncate">@{v.user.username}</div>
                        </div>
                      </div>
                      <span className="text-[10px] text-zinc-500 font-mono tabular-nums shrink-0">
                        {v.viewed_at
                          ? new Date(v.viewed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                          : ''}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Add Story to Highlight Sheet Overlay */}
        <AnimatePresence>
          {highlightSheetOpen && currentStory && (
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ duration: 0.2 }}
              onPointerDown={(e) => e.stopPropagation()}
              className="absolute inset-x-0 bottom-0 max-h-[65%] bg-zinc-950/95 backdrop-blur-xl border-t border-white/15 rounded-t-3xl z-40 flex flex-col p-4"
            >
              <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-white">
                  <BookmarkPlus className="w-4 h-4 text-zinc-300" />
                  <span>Add to Highlight</span>
                </div>
                <button
                  type="button"
                  onClick={() => setHighlightSheetOpen(false)}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {userHighlights.length > 0 && (
                <div className="flex gap-2.5 overflow-x-auto no-scrollbar pb-3 mb-3 border-b border-white/10">
                  {userHighlights.map((h) => (
                    <button
                      key={h.id}
                      type="button"
                      disabled={savingHighlight}
                      onClick={async () => {
                        setSavingHighlight(true);
                        try {
                          await api.addStoryToHighlight(h.id, {
                            imageUrl: currentStory.imageUrl,
                            caption: currentStory.caption,
                            tags: currentStory.tags,
                          });
                          soundFX.playSuccess();
                          showToast(`Added to "${h.title}"`);
                          setHighlightSheetOpen(false);
                        } catch {
                          showToast('Could not add to highlight');
                        } finally {
                          setSavingHighlight(false);
                        }
                      }}
                      className="flex flex-col items-center gap-1.5 shrink-0 cursor-pointer group"
                    >
                      <div className="w-12 h-12 rounded-full overflow-hidden border border-white/25 group-hover:border-white transition bg-zinc-900">
                        <img
                          src={h.cover_url}
                          alt={h.title}
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display = 'none';
                          }}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <span className="text-[10px] text-zinc-300 max-w-[60px] truncate">{h.title}</span>
                    </button>
                  ))}
                </div>
              )}

              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const title = newHighlightTitle.trim() || 'Highlights';
                  setSavingHighlight(true);
                  try {
                    await api.createHighlight(title, currentStory.imageUrl, {
                      imageUrl: currentStory.imageUrl,
                      caption: currentStory.caption,
                      tags: currentStory.tags,
                    });
                    soundFX.playSuccess();
                    showToast(`Created highlight "${title}"`);
                    setNewHighlightTitle('');
                    setHighlightSheetOpen(false);
                  } catch {
                    showToast('Could not create highlight');
                  } finally {
                    setSavingHighlight(false);
                  }
                }}
                className="flex items-center gap-2"
              >
                <input
                  type="text"
                  value={newHighlightTitle}
                  onChange={(e) => setNewHighlightTitle(e.target.value)}
                  maxLength={32}
                  placeholder="New highlight name..."
                  className="glass-input flex-1 px-3.5 py-2 rounded-xl text-xs"
                />
                <button
                  type="submit"
                  disabled={savingHighlight}
                  className="glass-button-primary px-4 py-2 text-xs font-semibold cursor-pointer disabled:opacity-50"
                >
                  {savingHighlight ? '...' : 'Create'}
                </button>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      <WarningPopup
        open={!!confirmDeleteType}
        title={confirmDeleteType === 'highlight' ? 'Delete highlight?' : 'Delete story?'}
        message={
          confirmDeleteType === 'highlight'
            ? 'This highlight will be permanently removed from your profile.'
            : 'This story will be permanently removed.'
        }
        confirmLabel="Delete"
        tone="danger"
        loading={deletingItem}
        loadingLabel="Deleting..."
        onCancel={() => !deletingItem && setConfirmDeleteType(null)}
        onConfirm={async () => {
          setDeletingItem(true);
          try {
            if (confirmDeleteType === 'highlight') {
              await onDeleteHighlight?.();
            } else if (currentStory) {
              await onDelete(currentStory.id, currentStory.audience);
            }
            setConfirmDeleteType(null);
          } finally {
            setDeletingItem(false);
          }
        }}
      />
    </motion.div>
  );
};

const CreateStoryModal: React.FC<{ onClose: () => void; onSuccess: () => void }> = ({
  onClose,
  onSuccess,
}) => {
  const { user, showToast } = useAuth();
  const [imageUrl, setImageUrl] = useState('');
  const [caption, setCaption] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [audience, setAudience] = useState<'everyone' | 'close_friends'>('everyone');
  const [closeFriendsModalOpen, setCloseFriendsModalOpen] = useState(false);
  const [suggestedMembers, setSuggestedMembers] = useState<User[]>(
    () => (api.getCachedSuggestedUsers() || []).filter((u) => u.id !== user?.id).slice(0, 5)
  );
  const [uploadingImage, setUploadingImage] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (suggestedMembers.length === 0) {
      api.getSuggestedUsers()
        .then((res) => {
          setSuggestedMembers(res.users.filter((u) => u.id !== user?.id).slice(0, 5));
        })
        .catch(() => {});
    }
  }, [user?.id]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting && !closeFriendsModalOpen) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, submitting, closeFriendsModalOpen]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    setUploadingImage(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64 = reader.result as string;
        const res = await api.uploadImage(base64);
        setImageUrl(res.url);
      } catch {
        showToast('Image upload failed');
      } finally {
        setUploadingImage(false);
      }
    };
    reader.onerror = () => setUploadingImage(false);
    reader.readAsDataURL(file);
  };

  const addTag = (raw: string) => {
    const clean = raw.trim().replace(/\s+/g, '');
    if (!clean) return;
    const normalized =
      clean.startsWith('@') || clean.startsWith('#') ? clean : `@${clean.toLowerCase()}`;
    if (normalized.length < 2) return;
    if (tags.includes(normalized) || tags.length >= 10) {
      setTagInput('');
      return;
    }
    setTags((prev) => [...prev, normalized]);
    setTagInput('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!imageUrl) {
      showToast('Please select an image file');
      return;
    }

    setSubmitting(true);
    try {
      const pendingTag = tagInput.trim().replace(/\s+/g, '');
      const finalTags = pendingTag
        ? Array.from(new Set([...tags, pendingTag.startsWith('@') || pendingTag.startsWith('#') ? pendingTag : `@${pendingTag.toLowerCase()}`]))
        : tags;
      await api.createStory(imageUrl, caption, finalTags, audience);
      soundFX.playSuccess();
      showToast(
        audience === 'close_friends'
          ? 'Close Friends story shared for 24 hours'
          : 'Story published for 24 hours'
      );
      onSuccess();
    } catch (err: any) {
      showToast(err.message || 'Failed to create story');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[110] bg-black/80 backdrop-blur-xl flex items-center justify-center p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="glass-surface w-full max-w-md rounded-3xl p-5 sm:p-6 border border-white/15 relative max-h-[90dvh] overflow-y-auto my-auto"
      >
        <div className="flex items-center justify-between pb-4 border-b border-white/10 mb-5">
          <h3 className="text-base font-semibold text-white">Create New Story</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close create story"
            className="w-10 h-10 flex items-center justify-center rounded-full text-zinc-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="text-xs font-medium text-zinc-300 block mb-2">
              Upload Story Photo
            </label>
            <label className="border-2 border-dashed border-white/20 hover:border-white/40 rounded-2xl p-6 flex flex-col items-center justify-center gap-2 cursor-pointer transition bg-white/[0.02]">
              <Upload className="w-6 h-6 text-zinc-400" />
              <span className="text-xs text-zinc-300 font-medium">
                {uploadingImage ? 'Processing image...' : 'Select image from device'}
              </span>
              <span className="text-[10px] text-zinc-500">JPG, PNG, WEBP</span>
              <input
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
          </div>

          {imageUrl && (
            <div className="relative h-48 rounded-2xl overflow-hidden border border-white/15 bg-black">
              <img src={imageUrl} alt="preview" className="w-full h-full object-cover" />
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-zinc-300 block mb-1">
              Caption (Optional)
            </label>
            <input
              type="text"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Add observation..."
              maxLength={100}
              className="glass-input w-full px-4 py-2.5 rounded-xl text-sm"
            />
          </div>

          {/* Story Tagging */}
          <div>
            <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5 mb-1.5">
              <Tag className="w-3.5 h-3.5 text-zinc-400" />
              <span>Tag People or Topics (Optional)</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    addTag(tagInput);
                  }
                }}
                placeholder="@username or #topic"
                className="glass-input flex-1 px-3.5 py-2 rounded-xl text-xs font-mono"
              />
              <button
                type="button"
                onClick={() => addTag(tagInput)}
                disabled={!tagInput.trim()}
                className="px-3.5 py-2 rounded-xl glass-pill text-xs font-semibold text-white hover:bg-white/15 disabled:opacity-40 cursor-pointer"
              >
                Add
              </button>
            </div>

            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {tags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/10 border border-white/15 text-[11px] font-medium text-white"
                  >
                    <span>{t}</span>
                    <button
                      type="button"
                      onClick={() => setTags((prev) => prev.filter((item) => item !== t))}
                      aria-label={`Remove ${t}`}
                      className="text-zinc-400 hover:text-white cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {suggestedMembers.length > 0 && (
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar mt-2 pt-1">
                <span className="text-[10px] text-zinc-500 shrink-0">Quick tag:</span>
                {suggestedMembers.map((m) => {
                  const tagVal = `@${m.username}`;
                  const added = tags.includes(tagVal);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() =>
                        added
                          ? setTags((prev) => prev.filter((item) => item !== tagVal))
                          : addTag(tagVal)
                      }
                      className={`px-2.5 py-1 rounded-full text-[10px] font-mono shrink-0 border transition cursor-pointer ${
                        added
                          ? 'bg-white text-black border-white font-semibold'
                          : 'bg-white/[0.04] border-white/10 text-zinc-300 hover:bg-white/10'
                      }`}
                    >
                      {tagVal}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Audience Selector (Everyone vs Close Friends) */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-zinc-300">Audience</label>
              <button
                type="button"
                onClick={() => setCloseFriendsModalOpen(true)}
                className="text-[11px] font-medium text-emerald-400 hover:underline cursor-pointer"
              >
                Manage Close Friends
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setAudience('everyone')}
                className={`py-2.5 px-3 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                  audience === 'everyone'
                    ? 'bg-white text-black border-white'
                    : 'bg-white/[0.04] text-zinc-300 border-white/10 hover:bg-white/10'
                }`}
              >
                Your Story
              </button>
              <button
                type="button"
                onClick={() => setAudience('close_friends')}
                className={`py-2.5 px-3 rounded-xl text-xs font-semibold border flex items-center justify-center gap-1.5 transition cursor-pointer ${
                  audience === 'close_friends'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/50'
                    : 'bg-white/[0.04] text-zinc-300 border-white/10 hover:bg-white/10'
                }`}
              >
                <Star className="w-3.5 h-3.5 fill-emerald-400 text-emerald-400" />
                <span>Close Friends</span>
              </button>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs text-zinc-400 hover:text-white"
            >
              Cancel
            </button>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              type="submit"
              disabled={submitting || uploadingImage || !imageUrl}
              className="glass-button-primary px-6 py-2.5 text-xs font-semibold disabled:opacity-50"
            >
              {submitting
                ? 'Sharing...'
                : audience === 'close_friends'
                ? 'Share to Close Friends'
                : 'Share to Story'}
            </motion.button>
          </div>
        </form>
      </motion.div>

      {closeFriendsModalOpen && (
        <CloseFriendsModal onClose={() => setCloseFriendsModalOpen(false)} />
      )}
    </div>
  );
};
