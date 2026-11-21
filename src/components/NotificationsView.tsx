import React, { useState, useEffect } from 'react';
import {
  Heart,
  MessageCircle,
  UserPlus,
  CheckCircle2,
  Sparkles,
  Mail,
  Check,
  Trash2,
  Repeat2,
  Quote,
  AtSign,
} from 'lucide-react';
import { NotificationItem } from '../types';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Avatar } from './Avatar';
import { soundFX } from '../lib/sounds';

interface NotificationsViewProps {
  onOpenProfile: (username: string) => void;
  onOpenPost?: (postId: string) => void;
  onOpenMessages?: (userId?: string, conversationId?: string) => void;
  onOpenFollowingSection?: (username: string) => void;
  onOpenFollowRequests?: () => void;
}

export const NotificationsView: React.FC<NotificationsViewProps> = ({
  onOpenProfile,
  onOpenPost,
  onOpenMessages,
  onOpenFollowingSection,
  onOpenFollowRequests,
}) => {
  const { user, authConfirmedUid, refreshMe, brandName, showToast } = useAuth();
  const [notifications, setNotifications] = useState<NotificationItem[]>(
    () => api.getCachedNotifications() || []
  );
  const [loading, setLoading] = useState<boolean>(() => {
    const cached = api.getCachedNotifications();
    return !cached || cached.length === 0;
  });
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    if (!authConfirmedUid || !user?.id || user.id !== authConfirmedUid) {
      setLoading(false);
      return;
    }

    const unsubscribe = api.subscribeNotifications((liveNotifications) => {
      setNotifications(liveNotifications);
      setLoading(false);
    });

    const safetyTimer = setTimeout(() => setLoading(false), 3000);
    return () => {
      clearTimeout(safetyTimer);
      unsubscribe();
    };
  }, [authConfirmedUid, user?.id]);

  const handleMarkAllRead = async () => {
    if (notifications.length === 0) return;
    soundFX.playTap();
    setNotifications((prev) => prev.map((n) => ({ ...n, read: 1 })));
    try {
      await api.markAllNotificationsRead();
      refreshMe();
    } catch {}
  };

  const handleClearAll = async () => {
    if (clearing || notifications.length === 0) return;
    const prev = notifications;
    setClearing(true);
    setNotifications([]);
    try {
      await api.clearAllNotifications();
      soundFX.playSuccess();
      refreshMe();
      showToast('All alerts removed');
    } catch {
      setNotifications(prev);
      showToast('Could not remove alerts');
    } finally {
      setClearing(false);
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'like':
        return <Heart className="w-4 h-4 text-rose-400 fill-rose-400" />;
      case 'comment':
      case 'reply':
        return <MessageCircle className="w-4 h-4 text-sky-400" />;
      case 'repost':
        return <Repeat2 className="w-4 h-4 text-emerald-400" />;
      case 'quote':
        return <Quote className="w-4 h-4 text-indigo-400" />;
      case 'story_tag':
      case 'mention':
        return <AtSign className="w-4 h-4 text-amber-300" />;
      case 'follow':
      case 'follow_request':
        return <UserPlus className="w-4 h-4 text-emerald-400" />;
      case 'message':
        return <Mail className="w-4 h-4 text-amber-400" />;
      default:
        return <Sparkles className="w-4 h-4 text-white" />;
    }
  };

  const getMessage = (n: NotificationItem) => {
    switch (n.type) {
      case 'like':
        return 'liked your post.';
      case 'comment':
        return 'commented on your post.';
      case 'reply':
        return 'replied to your comment.';
      case 'repost':
        return 'reposted your post.';
      case 'quote':
        return 'quoted your post.';
      case 'story_tag':
        return 'tagged you in their story.';
      case 'mention':
        return 'mentioned you in a post.';
      case 'follow':
        return 'began following your observations.';
      case 'follow_request':
        return 'requested to follow your private portfolio.';
      case 'message':
        return 'sent you a private message.';
      case 'welcome':
        return `welcome to ${brandName || 'SYNC'}. A space for deliberate aesthetics without the noise.`;
      default:
        return 'interacted with your content.';
    }
  };

  const formatTime = (isoString: string) => {
    try {
      if (!isoString) return 'Recently';
      let d = new Date(isoString);
      if (!Number.isFinite(d.getTime())) {
        d = new Date(isoString.includes('Z') ? isoString : `${isoString}Z`);
      }
      if (!Number.isFinite(d.getTime())) return 'Recently';
      const diffSecs = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
      if (diffSecs < 60) return 'Just now';
      if (diffSecs < 3600) return `${Math.floor(diffSecs / 60)}m ago`;
      if (diffSecs < 86400) return `${Math.floor(diffSecs / 3600)}h ago`;
      return `${Math.floor(diffSecs / 86400)}d ago`;
    } catch {
      return 'Recently';
    }
  };

  return (
    <div className="max-w-2xl mx-auto pb-16">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-6 pb-4 border-b border-white/10">
        <h2 className="text-base sm:text-lg font-bold text-white tracking-wide">Activity & Alerts</h2>
        {notifications.length > 0 && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleMarkAllRead}
              className="flex items-center gap-1.5 min-h-[38px] px-2.5 rounded-xl text-xs text-zinc-400 hover:text-white hover:bg-white/5 transition active:scale-95 cursor-pointer whitespace-nowrap"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Mark all read</span>
            </button>
            <button
              type="button"
              onClick={handleClearAll}
              disabled={clearing}
              className="flex items-center gap-1.5 min-h-[38px] px-2.5 rounded-xl text-xs text-zinc-400 hover:text-red-300 hover:bg-red-500/10 transition active:scale-95 cursor-pointer disabled:opacity-40 whitespace-nowrap"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear all</span>
            </button>
          </div>
        )}
      </div>

      {loading && notifications.length === 0 ? (
        <div className="flex flex-col gap-2.5">
          {[0, 1, 2].map((idx) => (
            <div key={idx} className="p-4 rounded-2xl glass-surface flex items-center gap-3.5 animate-pulse">
              <div className="w-10 h-10 rounded-full bg-white/[0.08] shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-3/4 rounded-full bg-white/[0.08]" />
                <div className="h-2.5 w-20 rounded-full bg-white/[0.05]" />
              </div>
            </div>
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <div className="glass-card rounded-3xl p-12 text-center border border-white/5">
          <CheckCircle2 className="w-8 h-8 text-zinc-600 mx-auto mb-3" />
          <h4 className="text-sm font-semibold text-white mb-1">Clear Horizon</h4>
          <p className="text-xs text-zinc-500">You are completely caught up with all interactions.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {notifications.map((n) => (
            <div
              key={n.id}
              onClick={() => {
                soundFX.playTap();
                if (!n.read) {
                  setNotifications((prev) =>
                    prev.map((item) => (item.id === n.id ? { ...item, read: 1 } : item))
                  );
                  api.markNotificationRead(n.id).then(() => refreshMe()).catch(() => {});
                }
                if (n.type === 'message' && onOpenMessages) {
                  onOpenMessages(n.actor_id, n.target_id);
                } else if (n.type === 'follow' && n.actor_username && onOpenFollowingSection) {
                  onOpenFollowingSection(n.actor_username);
                } else if (n.type === 'follow_request' && onOpenFollowRequests) {
                  onOpenFollowRequests();
                } else if (
                  (n.type === 'like' ||
                    n.type === 'comment' ||
                    n.type === 'reply' ||
                    n.type === 'repost' ||
                    n.type === 'quote' ||
                    n.type === 'mention') &&
                  n.target_id &&
                  onOpenPost
                ) {
                  onOpenPost(n.target_id);
                } else if (n.actor_username) {
                  onOpenProfile(n.actor_username);
                }
              }}
              className={`p-3.5 sm:p-4 rounded-2xl glass-surface flex items-center justify-between gap-3 cursor-pointer transition-colors duration-150 active:scale-[0.99] ${
                !n.read ? 'border-white/25 bg-white/[0.08] shadow-[0_4px_16px_rgba(255,255,255,0.04)]' : 'hover:border-white/15 hover:bg-white/[0.04]'
              }`}
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="relative shrink-0">
                  <Avatar
                    userId={n.actor_id}
                    presencePosition="top-right"
                    name={n.actor_display_name}
                    url={n.actor_avatar_url}
                    size="md"
                  />
                  <div className="absolute -bottom-1 -right-1 p-1 rounded-full bg-black border border-white/10">
                    {getIcon(n.type)}
                  </div>
                </div>

                <div className="min-w-0 text-xs break-words">
                  <div className="text-zinc-200 leading-relaxed">
                    <span className="font-semibold text-white mr-1.5">
                      {n.actor_display_name}
                    </span>
                    <span className="text-zinc-400">{getMessage(n)}</span>
                  </div>
                  <div className="text-[10px] text-zinc-500 font-mono mt-0.5">
                    {formatTime(n.created_at)}
                  </div>
                </div>
              </div>

              {!n.read && (
                <span className="w-2 h-2 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)] shrink-0" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
