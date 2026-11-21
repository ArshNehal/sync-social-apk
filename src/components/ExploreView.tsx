import React, { useState, useEffect } from 'react';
import { Search, Sparkles, TrendingUp, Users, Hash, MessageSquare, UserPlus } from 'lucide-react';
import { User, Post } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { PostCard } from './PostCard';
import { Avatar } from './Avatar';
import { soundFX } from '../lib/sounds';
import { parsePostContent } from '../lib/postMeta';

interface ExploreViewProps {
  onOpenProfile: (username: string) => void;
  onOpenLikedBy: (postId: string) => void;
  onOpenReport: (postId: string) => void;
  initialTag?: string | null;
  focusSearch?: boolean;
  onOpenChat?: (userId: string) => void;
  onOpenInvite?: () => void;
  onQuotePost?: (post: Post) => void;
  onRepostCreated?: (post: Post) => void;
}

export const ExploreView: React.FC<ExploreViewProps> = ({
  onOpenProfile,
  onOpenLikedBy,
  onOpenReport,
  initialTag,
  focusSearch,
  onOpenChat,
  onOpenInvite,
  onQuotePost,
  onRepostCreated,
}) => {
  const { authConfirmedUid, openAuth, showToast } = useAuth();
  const [searchTerm, setSearchTerm] = useState(initialTag || '');
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const [suggestedUsers, setSuggestedUsers] = useState<User[]>(
    () => api.getCachedSuggestedUsers() || []
  );
  const [searchResults, setSearchResults] = useState<{
    users: User[];
    posts: Post[];
    hashtags: { tag: string; count: number }[];
  }>({
    users: [],
    posts: [],
    hashtags: [
      { tag: 'sync', count: 142 },
      { tag: 'minimalism', count: 98 },
      { tag: 'architecture', count: 76 },
      { tag: 'monochrome', count: 64 },
      { tag: 'craft', count: 42 },
      { tag: 'tokyo', count: 39 },
      { tag: 'industrialdesign', count: 31 },
    ],
  });
  const [trendingPosts, setTrendingPosts] = useState<Post[]>(
    () => api.getCachedPosts({ feed: 'latest' }) || []
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const unsubUsers = api.subscribeSuggestedUsers((users) => {
      setSuggestedUsers(users);
    });
    const unsubPosts = api.subscribeFeed({ feed: 'latest' }, (posts) => {
      setTrendingPosts(posts);
    });

    const handlePostUpdated = (e: Event) => {
      const detail = (e as CustomEvent<{ id: string; patch: Partial<Post> }>).detail;
      if (!detail?.id) return;
      setTrendingPosts((prev) => prev.map((p) => (p.id === detail.id ? { ...p, ...detail.patch } : p)));
      setSearchResults((prev) => ({
        ...prev,
        posts: prev.posts.map((p) => (p.id === detail.id ? { ...p, ...detail.patch } : p)),
      }));
    };
    const handlePostDeleted = (e: Event) => {
      const deletedId = (e as CustomEvent<string>).detail;
      if (!deletedId) return;
      setTrendingPosts((prev) => prev.filter((p) => p.id !== deletedId));
      setSearchResults((prev) => ({
        ...prev,
        posts: prev.posts.filter((p) => p.id !== deletedId),
      }));
    };

    window.addEventListener('sync:post-updated', handlePostUpdated);
    window.addEventListener('sync:post-deleted', handlePostDeleted);
    return () => {
      unsubUsers();
      unsubPosts();
      window.removeEventListener('sync:post-updated', handlePostUpdated);
      window.removeEventListener('sync:post-deleted', handlePostDeleted);
    };
  }, [authConfirmedUid]);

  useEffect(() => {
    if (focusSearch) {
      const t = setTimeout(() => searchInputRef.current?.focus(), 100);
      return () => clearTimeout(t);
    }
  }, [focusSearch]);

  useEffect(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) {
      setLoading(false);
      return;
    }

    // 0ms instant client-side search preview over already cached posts & users
    const cleanQ = q.startsWith('#') ? q.slice(1) : q;
    const instantUsers = suggestedUsers.filter(
      (u) =>
        u.username.toLowerCase().includes(cleanQ) ||
        u.display_name.toLowerCase().includes(cleanQ)
    );
    const instantPosts = trendingPosts.filter((p) => {
      const clean = parsePostContent(p.content || '').cleanText.toLowerCase();
      return (
        clean.includes(q) ||
        clean.includes(cleanQ) ||
        p.username.toLowerCase().includes(cleanQ) ||
        p.display_name.toLowerCase().includes(cleanQ)
      );
    });
    setSearchResults((prev) => ({
      ...prev,
      users: instantUsers,
      posts: instantPosts,
    }));

    const delay = setTimeout(async () => {
      if (instantPosts.length === 0 && instantUsers.length === 0) {
        setLoading(true);
      }
      try {
        const res = await api.search(searchTerm);
        setSearchResults(res);
      } catch {}
      setLoading(false);
    }, 160);

    return () => clearTimeout(delay);
  }, [searchTerm]);

  const handleFollow = async (u: User) => {
    const prevFollowed = !!u.is_following;
    if (prevFollowed) soundFX.playUnlike();
    else soundFX.playSuccess();
    setSuggestedUsers((prev) =>
      prev.map((item) => (item.id === u.id ? { ...item, is_following: !prevFollowed } : item))
    );
    try {
      if (prevFollowed) {
        await api.unfollowUser(u.id);
        showToast(`Unfollowed @${u.username}`);
      } else {
        const res = await api.followUser(u.id);
        showToast(res.status === 'requested' ? 'Follow requested' : `Following @${u.username}`);
      }
    } catch (e: any) {
      setSuggestedUsers((prev) =>
        prev.map((item) => (item.id === u.id ? { ...item, is_following: prevFollowed } : item))
      );
      showToast(e.message || 'Follow failed');
    }
  };

  return (
    <div className="max-w-2xl mx-auto pb-16">
      {/* Search Header */}
      <div className="relative mb-5 sm:mb-6">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-zinc-500 pointer-events-none" />
        <input
          ref={searchInputRef}
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search by name, @username, or #tag..."
          className="glass-input w-full pl-11 sm:pl-12 pr-16 py-3 sm:py-3.5 rounded-2xl text-sm placeholder-zinc-500"
        />
        {searchTerm && (
          <button
            type="button"
            onClick={() => setSearchTerm('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 px-2 py-1 text-xs font-medium text-zinc-400 hover:text-white"
          >
            Clear
          </button>
        )}
      </div>

      {/* Hashtag Quick Filter Cloud */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
          <TrendingUp className="w-3.5 h-3.5" />
          <span>Curated Disciplines & Tags</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {searchResults.hashtags.map((h) => (
            <button
              type="button"
              key={h.tag}
              onClick={() => {
                soundFX.playTap();
                setSearchTerm(`#${h.tag}`);
              }}
              className={`px-3.5 min-h-[36px] rounded-full text-xs font-medium transition cursor-pointer select-none active:scale-95 ${
                searchTerm.toLowerCase().includes(h.tag)
                  ? 'bg-white text-black font-semibold shadow-md'
                  : 'glass-pill text-zinc-300 hover:text-white'
              }`}
            >
              #{h.tag}
            </button>
          ))}
        </div>
      </div>

      {/* Real Members Section */}
      {!searchTerm && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3.5">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
              <Users className="w-3.5 h-3.5" />
              <span>Real Members</span>
            </div>
            {onOpenInvite && (
              <button
                onClick={onOpenInvite}
                className="text-xs text-zinc-400 hover:text-white flex items-center gap-1 cursor-pointer transition"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Invite</span>
              </button>
            )}
          </div>

          {suggestedUsers.length === 0 ? (
            <div className="glass-card rounded-2xl p-6 text-center border border-white/10">
              <div className="w-10 h-10 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-2.5 text-zinc-400">
                <Users className="w-5 h-5" />
              </div>
              <h4 className="text-sm font-semibold text-white mb-1">Pioneer Real Member</h4>
              <p className="text-xs text-zinc-400 max-w-sm mx-auto mb-4 leading-relaxed">
                You are one of the earliest real members on the platform. Share your direct link so friends and collaborators can join and follow you.
              </p>
              {onOpenInvite && (
                <button
                  onClick={onOpenInvite}
                  className="glass-button-primary px-4 py-2 text-xs font-semibold inline-flex items-center gap-1.5"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Invite Friends to Connect</span>
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {suggestedUsers.map((u) => (
                <div
                  key={u.id}
                  className="glass-card rounded-2xl p-4 border border-white/10 flex items-center justify-between hover:border-white/20 transition-colors duration-150"
                >
                  <div
                    onClick={() => onOpenProfile(u.username)}
                    className="flex items-center gap-3 cursor-pointer min-w-0"
                  >
                    <Avatar
                      userId={u.id}
                      name={u.display_name}
                      url={u.avatar_url}
                      size="md"
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-white truncate flex items-center gap-1">
                        {u.display_name}
                        {u.is_verified ? (
                          <Sparkles className="w-3 h-3 text-zinc-300 shrink-0" />
                        ) : null}
                      </div>
                      <div className="text-xs text-zinc-500 font-mono truncate">@{u.username}</div>
                      {u.bio && (
                        <div className="text-[11px] text-zinc-400 line-clamp-1 mt-0.5">{u.bio}</div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 ml-3 shrink-0">
                    {onOpenChat && (
                      <button
                        type="button"
                        onClick={() => onOpenChat(u.id)}
                        className="w-10 h-10 flex items-center justify-center rounded-xl bg-white/5 hover:bg-white/15 text-zinc-400 hover:text-white transition cursor-pointer active:scale-90"
                        title="Send Message"
                        aria-label={`Message ${u.display_name}`}
                      >
                        <MessageSquare className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleFollow(u)}
                      className={`px-3.5 min-h-[38px] rounded-xl text-xs font-semibold shrink-0 transition cursor-pointer active:scale-95 whitespace-nowrap ${
                        u.is_following
                          ? 'bg-white/10 text-white hover:bg-white/20'
                          : 'glass-button-primary'
                      }`}
                    >
                      {u.is_following ? 'Following' : 'Follow'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Search Results: Users */}
      {searchTerm && searchResults.users.length > 0 && (
        <div className="mb-8">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">
            People ({searchResults.users.length})
          </h3>
          <div className="flex flex-col gap-2">
            {searchResults.users.map((u) => (
              <div
                key={u.id}
                onClick={() => onOpenProfile(u.username)}
                className="glass-surface p-3 rounded-2xl flex items-center gap-3.5 cursor-pointer hover:bg-white/10 transition min-w-0"
              >
                <Avatar
                  userId={u.id}
                  name={u.display_name}
                  url={u.avatar_url}
                  size="md"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-white flex items-center gap-1 truncate">
                    <span className="truncate">{u.display_name}</span>
                    {u.is_verified ? <Sparkles className="w-3 h-3 text-zinc-300 shrink-0" /> : null}
                  </div>
                  <div className="text-xs text-zinc-500 font-mono truncate">@{u.username}</div>
                  {u.bio && <div className="text-xs text-zinc-400 mt-0.5 line-clamp-1">{u.bio}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search Results: Posts or Trending Feed */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-4">
          {searchTerm ? `Posts matching "${searchTerm}"` : 'Trending Inquiries & Works'}
        </h3>

        {loading ? (
          <div className="flex flex-col gap-4">
            {[0, 1].map((idx) => (
              <div
                key={idx}
                className="glass-card rounded-3xl p-5 border border-white/[0.08] animate-pulse"
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-white/[0.08]" />
                  <div className="space-y-2 flex-1">
                    <div className="h-3 w-32 rounded-full bg-white/[0.08]" />
                    <div className="h-2.5 w-20 rounded-full bg-white/[0.05]" />
                  </div>
                </div>
                <div className="h-3 w-full rounded-full bg-white/[0.06] mb-2" />
                <div className="h-3 w-3/4 rounded-full bg-white/[0.05]" />
              </div>
            ))}
          </div>
        ) : (searchTerm ? searchResults.posts : trendingPosts).length === 0 ? (
          <div className="glass-card rounded-3xl p-10 text-center border border-white/5 flex flex-col items-center gap-3">
            <span className="text-zinc-500 text-xs">No posts found matching your criteria.</span>
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="px-4 min-h-[36px] rounded-xl glass-pill text-xs font-medium text-zinc-200 hover:text-white cursor-pointer"
              >
                Clear search
              </button>
            )}
          </div>
        ) : (
          (searchTerm ? searchResults.posts : trendingPosts).map((post, idx) => (
            <PostCard
              key={post.id}
              post={post}
              priorityImage={idx < 2}
              onOpenProfile={onOpenProfile}
              onOpenLikedBy={onOpenLikedBy}
              onOpenReport={onOpenReport}
              onQuotePost={onQuotePost}
              onRepostCreated={onRepostCreated}
              onPostUpdated={(updated) => {
                setTrendingPosts((prev) =>
                  prev.map((p) => (p.id === post.id ? { ...p, ...updated } : p))
                );
                setSearchResults((prev) => ({
                  ...prev,
                  posts: prev.posts.map((p) => (p.id === post.id ? { ...p, ...updated } : p)),
                }));
              }}
              onPostDeleted={(postId) => {
                setTrendingPosts((prev) => prev.filter((p) => p.id !== postId));
                setSearchResults((prev) => ({
                  ...prev,
                  posts: prev.posts.filter((p) => p.id !== postId),
                }));
              }}
            />
          ))
        )}
      </div>
    </div>
  );
};
