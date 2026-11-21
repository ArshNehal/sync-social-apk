import React, { useState, useEffect } from 'react';
import { Bookmark, Sparkles } from 'lucide-react';
import { Post } from '../types';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { PostCard } from './PostCard';

interface BookmarksViewProps {
  onOpenProfile: (username: string) => void;
  onOpenLikedBy: (postId: string) => void;
  onOpenReport: (postId: string) => void;
  onQuotePost?: (post: Post) => void;
  onRepostCreated?: (post: Post) => void;
}

export const BookmarksView: React.FC<BookmarksViewProps> = ({
  onOpenProfile,
  onOpenLikedBy,
  onOpenReport,
  onQuotePost,
  onRepostCreated,
}) => {
  const { user, authConfirmedUid } = useAuth();
  const [posts, setPosts] = useState<Post[]>(() => api.getCachedBookmarks() || []);
  const [loading, setLoading] = useState<boolean>(() => {
    const cached = api.getCachedBookmarks();
    return !cached || cached.length === 0;
  });

  useEffect(() => {
    if (!authConfirmedUid || !user?.id || user.id !== authConfirmedUid) {
      setLoading(false);
      return;
    }

    const unsubscribe = api.subscribeBookmarks((livePosts) => {
      setPosts(livePosts);
      setLoading(false);
    });

    const safetyTimer = setTimeout(() => setLoading(false), 3000);
    return () => {
      clearTimeout(safetyTimer);
      unsubscribe();
    };
  }, [authConfirmedUid, user?.id]);

  return (
    <div className="max-w-2xl mx-auto pb-16">
      <div className="flex items-center gap-2.5 mb-6 pb-4 border-b border-white/10">
        <Bookmark className="w-5 h-5 text-white" />
        <h2 className="text-lg font-bold text-white tracking-wide">Saved Archive</h2>
      </div>

      {loading && posts.length === 0 ? (
        <div className="flex flex-col gap-5">
          {[0, 1].map((idx) => (
            <div key={idx} className="glass-card rounded-3xl p-5 border border-white/[0.08] animate-pulse">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-white/[0.08]" />
                <div className="space-y-2 flex-1">
                  <div className="h-3 w-32 rounded-full bg-white/[0.08]" />
                  <div className="h-2.5 w-20 rounded-full bg-white/[0.05]" />
                </div>
              </div>
              <div className="h-3 w-full rounded-full bg-white/[0.06] mb-2" />
              <div className="h-3 w-4/5 rounded-full bg-white/[0.05]" />
            </div>
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className="glass-card rounded-3xl p-12 text-center border border-white/5">
          <Bookmark className="w-8 h-8 text-zinc-600 mx-auto mb-3" />
          <h4 className="text-sm font-semibold text-white mb-1">No Saved Works</h4>
          <p className="text-xs text-zinc-500">
            Bookmark posts from the feed to curate your private reference library.
          </p>
        </div>
      ) : (
        posts.map((post, idx) => (
          <PostCard
            key={post.id}
            post={post}
            priorityImage={idx < 2}
            onOpenProfile={onOpenProfile}
            onOpenLikedBy={onOpenLikedBy}
            onOpenReport={onOpenReport}
            onQuotePost={onQuotePost}
            onRepostCreated={onRepostCreated}
            onPostUpdated={(up) => {
              if (up.is_bookmarked === false) {
                setPosts((prev) => prev.filter((p) => p.id !== post.id));
              } else {
                setPosts((prev) =>
                  prev.map((p) => (p.id === post.id ? { ...p, ...up } : p))
                );
              }
            }}
            onPostDeleted={(id) => setPosts((prev) => prev.filter((p) => p.id !== id))}
          />
        ))
      )}
    </div>
  );
};
