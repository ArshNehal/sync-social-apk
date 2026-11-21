import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Heart,
  MessageCircle,
  Bookmark,
  Share2,
  MoreHorizontal,
  Send,
  Trash2,
  Edit2,
  Flag,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  X,
  Repeat2,
  Quote,
  Pin,
  EyeOff,
  Eye,
  MessageSquareOff,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Post, Comment } from '../types';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Avatar } from './Avatar';
import { SharePostModal, WarningPopup } from './Modals';
import { soundFX } from '../lib/sounds';
import { NativeBridge } from '../lib/native';
import { ZoomableImageLightbox } from './ZoomableImageLightbox';
import { parsePostContent } from '../lib/postMeta';

interface PostCardProps {
  post: Post;
  priorityImage?: boolean;
  showPinnedBadge?: boolean;
  onPostUpdated?: (updatedPost: Partial<Post>) => void;
  onPostDeleted?: (postId: string) => void;
  onOpenProfile: (username: string) => void;
  onOpenLikedBy: (postId: string) => void;
  onOpenReport: (postId: string) => void;
  onQuotePost?: (post: Post) => void;
  onRepostCreated?: (newPost: Post) => void;
}

export const PostCard: React.FC<PostCardProps> = ({
  post,
  priorityImage = false,
  showPinnedBadge = false,
  onPostUpdated,
  onPostDeleted,
  onOpenProfile,
  onOpenLikedBy,
  onOpenReport,
  onQuotePost,
  onRepostCreated,
}) => {
  const { user, authConfirmedUid, openAuth, showToast } = useAuth();
  const [isLiked, setIsLiked] = useState(post.is_liked);
  const [likesCount, setLikesCount] = useState(post.likes_count ?? 0);
  const [commentsCount, setCommentsCount] = useState(post.comments_count ?? 0);
  const [repostsCount, setRepostsCount] = useState(post.reposts_count ?? 0);
  const [isBookmarked, setIsBookmarked] = useState(post.is_bookmarked);
  const [isPinned, setIsPinned] = useState(!!post.is_pinned);
  const [hideLikes, setHideLikes] = useState(!!post.hide_likes);
  const [commentsDisabled, setCommentsDisabled] = useState(!!post.comments_disabled);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [replyTarget, setReplyTarget] = useState<{ id: string; username: string } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [repostMenuOpen, setRepostMenuOpen] = useState(false);
  const [repostPending, setRepostPending] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const { cleanText } = parsePostContent(post.content);
  const [editContent, setEditContent] = useState(cleanText);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [likeAnimating, setLikeAnimating] = useState(false);
  const [doubleTapHeart, setDoubleTapHeart] = useState(false);
  const [likePending, setLikePending] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletingPost, setDeletingPost] = useState(false);
  const [commentToDeleteId, setCommentToDeleteId] = useState<string | null>(null);
  const [loadingComments, setLoadingComments] = useState(false);
  const [failedImages, setFailedImages] = useState<Record<number, boolean>>({});
  const [repostImageFailed, setRepostImageFailed] = useState(false);
  const touchStartXRef = React.useRef<number | null>(null);
  const lastPhotoTapRef = React.useRef<number>(0);
  const singleTapTimerRef = React.useRef<number | null>(null);
  const commentInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!likePending) {
      setIsLiked(post.is_liked);
      setLikesCount(post.likes_count ?? 0);
    }
    setCommentsCount(post.comments_count ?? 0);
    setRepostsCount(post.reposts_count ?? 0);
    setIsBookmarked(post.is_bookmarked);
    setIsPinned(!!post.is_pinned);
    setHideLikes(!!post.hide_likes);
    setCommentsDisabled(!!post.comments_disabled);
  }, [
    post.id,
    post.is_liked,
    post.likes_count,
    post.comments_count,
    post.reposts_count,
    post.is_bookmarked,
    post.is_pinned,
    post.hide_likes,
    post.comments_disabled,
    likePending,
  ]);

  React.useEffect(() => {
    if (!isEditing) {
      setEditContent(cleanText);
    }
  }, [cleanText, isEditing]);

  React.useEffect(() => {
    setFailedImages({});
    setRepostImageFailed(false);
    setActiveImageIndex(0);
  }, [post.id]);

  React.useEffect(() => {
    return () => {
      if (singleTapTimerRef.current !== null) {
        window.clearTimeout(singleTapTimerRef.current);
      }
    };
  }, []);

  React.useEffect(() => {
    if (!menuOpen && !repostMenuOpen && !deleteConfirmOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        setRepostMenuOpen(false);
        if (!deletingPost) setDeleteConfirmOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [menuOpen, repostMenuOpen, deleteConfirmOpen, deletingPost]);

  const isOwner = user && user.id === post.user_id;
  const displayAvatar = isOwner ? (user.avatar_url || '') : post.avatar_url;
  const displayName = isOwner ? user.display_name : post.display_name;
  const displayUsername = isOwner ? user.username : post.username;
  const displayVerified = isOwner ? !!user.is_verified : !!post.is_verified;

  const triggerLikeIfNeeded = () => {
    NativeBridge.triggerHaptic('medium');
    setDoubleTapHeart(true);
    setTimeout(() => setDoubleTapHeart(false), 720);
    if (!isLiked) {
      handleToggleLike();
    } else {
      soundFX.playLike();
    }
  };

  const handlePhotoTap = (imageUrl: string) => {
    const now = Date.now();
    if (now - lastPhotoTapRef.current < 270) {
      lastPhotoTapRef.current = 0;
      if (singleTapTimerRef.current !== null) {
        window.clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      triggerLikeIfNeeded();
      return;
    }
    lastPhotoTapRef.current = now;
    if (singleTapTimerRef.current !== null) {
      window.clearTimeout(singleTapTimerRef.current);
    }
    singleTapTimerRef.current = window.setTimeout(() => {
      singleTapTimerRef.current = null;
      soundFX.playTap();
      setLightboxImage(imageUrl);
    }, 180);
  };

  const handleToggleLike = async () => {
    if (!user) {
      openAuth('login');
      return;
    }
    if (likePending) return;

    const prevLiked = isLiked;
    const prevLikesCount = likesCount;
    const nextLiked = !prevLiked;
    const optimisticCount = nextLiked ? prevLikesCount + 1 : Math.max(0, prevLikesCount - 1);

    setLikePending(true);
    setIsLiked(nextLiked);
    setLikesCount(optimisticCount);

    if (nextLiked) {
      soundFX.playLike();
      setLikeAnimating(true);
      setTimeout(() => setLikeAnimating(false), 500);
    } else {
      soundFX.playUnlike();
    }

    try {
      const res = nextLiked
        ? await api.likePost(post.id, prevLikesCount, post.user_id)
        : await api.unlikePost(post.id, prevLikesCount);
      const confirmedCount = typeof res.likes_count === 'number' ? res.likes_count : optimisticCount;
      setIsLiked(res.liked);
      setLikesCount(confirmedCount);
      onPostUpdated?.({ is_liked: res.liked, likes_count: confirmedCount });
    } catch (err) {
      setIsLiked(prevLiked);
      setLikesCount(prevLikesCount);
      showToast('Could not update like. Please try again.');
    } finally {
      setLikePending(false);
    }
  };

  const handleRepostDirect = async () => {
    setRepostMenuOpen(false);
    if (!user) {
      openAuth('login');
      return;
    }
    if (repostPending) return;
    setRepostPending(true);
    soundFX.playSuccess();
    const nextCount = repostsCount + 1;
    setRepostsCount(nextCount);
    onPostUpdated?.({ reposts_count: nextCount });
    try {
      const res = await api.repostPost(post);
      onRepostCreated?.(res.post);
      showToast('Reposted to your feed');
    } catch {
      setRepostsCount(repostsCount);
      onPostUpdated?.({ reposts_count: repostsCount });
      showToast('Could not repost right now');
    } finally {
      setRepostPending(false);
    }
  };

  const handleToggleBookmark = async () => {
    if (!user) {
      openAuth('login');
      return;
    }

    const nextBookmarked = !isBookmarked;
    soundFX.playTap();
    setIsBookmarked(nextBookmarked);
    try {
      if (nextBookmarked) {
        await api.bookmarkPost(post.id);
        showToast('Saved to Bookmarks');
      } else {
        await api.unbookmarkPost(post.id);
        showToast('Removed from Bookmarks');
      }
      onPostUpdated?.({ is_bookmarked: nextBookmarked });
    } catch (err) {
      setIsBookmarked(!nextBookmarked);
      showToast('Could not update bookmark');
    }
  };

  const handleShare = () => {
    soundFX.playTap();
    setMenuOpen(false);
    setShareModalOpen(true);
  };

  // Real-time < 1s Firestore live subscription for expanded comments
  React.useEffect(() => {
    if (!commentsOpen) return;
    if (!commentsLoaded) setLoadingComments(true);

    const unsubscribe = api.subscribeComments(post.id, (liveComments) => {
      setComments((prev) => {
        // Keep any in-flight optimistic comments that have not resolved yet
        const pendingTemps = prev.filter(
          (c) =>
            c.id.startsWith('temp_cmt_') &&
            !liveComments.some(
              (lc) => lc.user_id === c.user_id && lc.content === c.content
            )
        );
        return pendingTemps.length > 0 ? [...liveComments, ...pendingTemps] : liveComments;
      });
      setCommentsLoaded(true);
      setLoadingComments(false);
      setCommentsCount(liveComments.length);
      onPostUpdated?.({ comments_count: liveComments.length });
    });

    return () => {
      unsubscribe();
    };
  }, [commentsOpen, post.id, authConfirmedUid]);

  const handleLoadComments = () => {
    soundFX.playTap();
    setCommentsOpen((prev) => !prev);
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      openAuth('login');
      return;
    }
    const rawText = commentText.trim();
    if (!rawText) return;

    const currentReplyTarget = replyTarget;
    const tempId = `temp_cmt_${Date.now()}`;
    const optimisticComment: Comment = {
      id: tempId,
      post_id: post.id,
      user_id: user.id,
      parent_id: currentReplyTarget?.id || null,
      content: rawText,
      likes_count: 0,
      created_at: new Date().toISOString(),
      username: user.username,
      display_name: user.display_name,
      avatar_url: user.avatar_url || '',
      is_verified: !!user.is_verified,
    };

    const optimisticCount = commentsCount + 1;
    setComments((prev) => [...prev, optimisticComment]);
    setCommentsCount(optimisticCount);
    setCommentsLoaded(true);
    setCommentText('');
    setReplyTarget(null);
    onPostUpdated?.({ comments_count: optimisticCount });

    try {
      const res = await api.createComment(
        post.id,
        rawText,
        currentReplyTarget?.id,
        post.user_id,
        commentsCount
      );
      const nextCount = typeof res.comments_count === 'number'
        ? res.comments_count
        : optimisticCount;
      setComments((prev) => prev.map((c) => (c.id === tempId ? res.comment : c)));
      setCommentsCount(nextCount);
      onPostUpdated?.({ comments_count: nextCount });
      soundFX.playSuccess();
    } catch {
      setComments((prev) => prev.filter((c) => c.id !== tempId));
      setCommentsCount((c) => Math.max(0, c - 1));
      setCommentText(rawText);
      setReplyTarget(currentReplyTarget);
      onPostUpdated?.({ comments_count: Math.max(0, optimisticCount - 1) });
      showToast('Failed to post comment');
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    const prevComments = comments;
    const prevCount = commentsCount;
    const optimisticNext = Math.max(0, prevCount - 1);
    setComments((prev) => prev.filter((c) => c.id !== commentId));
    setCommentsCount(optimisticNext);
    onPostUpdated?.({ comments_count: optimisticNext });

    try {
      const res = await api.deleteComment(commentId, post.id, prevCount);
      const nextCount = typeof res.comments_count === 'number' ? res.comments_count : optimisticNext;
      setCommentsCount(nextCount);
      onPostUpdated?.({ comments_count: nextCount });
      showToast('Comment deleted');
    } catch {
      setComments(prevComments);
      setCommentsCount(prevCount);
      onPostUpdated?.({ comments_count: prevCount });
      showToast('Failed to delete comment');
    }
  };

  const handleSaveEdit = async () => {
    try {
      const trimmed = editContent.trim();
      await api.updatePost(post.id, trimmed);
      setIsEditing(false);
      onPostUpdated?.({ content: trimmed });
      showToast('Post updated');
    } catch (err: any) {
      showToast('Failed to update post');
    }
  };

  const handleDeletePost = async () => {
    setDeletingPost(true);
    try {
      await api.deletePost(post.id);
      setDeleteConfirmOpen(false);
      onPostDeleted?.(post.id);
      showToast('Post deleted');
    } catch {
      showToast('Failed to delete post');
    } finally {
      setDeletingPost(false);
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

  const handleToggleCommentLike = async (comment: Comment) => {
    if (!user) {
      openAuth('login');
      return;
    }
    const prevLiked = !!comment.is_liked;
    const prevCount = comment.likes_count || 0;
    const nextLiked = !prevLiked;
    const optimisticCount = nextLiked ? prevCount + 1 : Math.max(0, prevCount - 1);

    if (nextLiked) soundFX.playLike();
    else soundFX.playUnlike();

    setComments((prev) =>
      prev.map((c) =>
        c.id === comment.id ? { ...c, is_liked: nextLiked, likes_count: optimisticCount } : c
      )
    );

    try {
      const res = nextLiked
        ? await api.likeComment(comment.id, prevCount)
        : await api.unlikeComment(comment.id, prevCount);
      setComments((prev) =>
        prev.map((c) =>
          c.id === comment.id ? { ...c, is_liked: res.liked, likes_count: res.likes_count } : c
        )
      );
    } catch {
      setComments((prev) =>
        prev.map((c) =>
          c.id === comment.id ? { ...c, is_liked: prevLiked, likes_count: prevCount } : c
        )
      );
    }
  };

  const handleTogglePin = async () => {
    const nextPinned = !isPinned;
    setMenuOpen(false);
    setIsPinned(nextPinned);
    try {
      const res = await api.togglePinPost(post.id, nextPinned);
      onPostUpdated?.({ is_pinned: res.is_pinned, pinned_at: res.pinned_at });
      showToast(res.is_pinned ? 'Pinned to profile' : 'Unpinned from profile');
    } catch (err: any) {
      setIsPinned(!nextPinned);
      showToast(err?.message || 'Could not update pin state');
    }
  };

  const handleToggleHideLikes = async () => {
    const nextHide = !hideLikes;
    setMenuOpen(false);
    setHideLikes(nextHide);
    try {
      await api.toggleHideLikes(post.id, nextHide);
      onPostUpdated?.({ hide_likes: nextHide });
      showToast(nextHide ? 'Like count hidden' : 'Like count visible');
    } catch {
      setHideLikes(!nextHide);
      showToast('Could not update like visibility');
    }
  };

  const handleToggleCommentsDisabled = async () => {
    const nextDisabled = !commentsDisabled;
    setMenuOpen(false);
    setCommentsDisabled(nextDisabled);
    try {
      await api.toggleCommentsDisabled(post.id, nextDisabled);
      onPostUpdated?.({ comments_disabled: nextDisabled });
      showToast(nextDisabled ? 'Commenting turned off' : 'Commenting enabled');
    } catch {
      setCommentsDisabled(!nextDisabled);
      showToast('Could not update commenting setting');
    }
  };

  const renderFormattedContent = (text: string) => {
    const parts = text.split(/(#[a-zA-Z0-9_]+|@[a-zA-Z0-9_.]{3,20})/g);
    return parts.map((part, i) => {
      if (part.startsWith('#')) {
        return (
          <span
            key={i}
            className="text-white font-medium hover:underline cursor-pointer select-none"
            onClick={(e) => {
              e.stopPropagation();
              window.dispatchEvent(new CustomEvent('noir:search-tag', { detail: part.slice(1) }));
            }}
          >
            {part}
          </span>
        );
      }
      if (part.startsWith('@')) {
        return (
          <span
            key={i}
            className="text-sky-300 font-medium hover:underline cursor-pointer select-none"
            onClick={(e) => {
              e.stopPropagation();
              soundFX.playTap();
              onOpenProfile(part.slice(1));
            }}
          >
            {part}
          </span>
        );
      }
      return part;
    });
  };

  return (
    <>
      <article className="glass-card rounded-3xl p-4 sm:p-5 md:p-6 mb-5 border border-white/[0.08] relative group transition-colors duration-200 hover:border-white/[0.16]">
        {showPinnedBadge && isPinned && (
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-300 mb-2 pl-1">
            <Pin className="w-3 h-3 text-white fill-white/60" />
            <span>Pinned post</span>
          </div>
        )}
        {post.is_repost && (
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-300/90 mb-2.5 pl-1">
            <Repeat2 className="w-3.5 h-3.5" />
            <span>Reposted by @{displayUsername}</span>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between gap-2 mb-3.5 sm:mb-4">
          <div
            onClick={() => onOpenProfile(displayUsername)}
            className="flex items-center gap-3 cursor-pointer group/author min-w-0 flex-1"
          >
            <Avatar
              userId={post.user_id}
              name={displayName}
              url={displayAvatar}
              size="md"
              className="group-hover/author:border-white transition shrink-0"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-white group-hover/author:text-zinc-200 min-w-0">
                <span className="truncate">{displayName}</span>
                {displayVerified ? (
                  <Sparkles className="w-3.5 h-3.5 text-zinc-300 shrink-0" />
                ) : null}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-zinc-500 font-mono truncate">
                <span className="truncate">@{displayUsername}</span>
                <span className="shrink-0">•</span>
                <span className="shrink-0">{formatTime(post.created_at)}</span>
              </div>
            </div>
          </div>

          {/* Menu Dropdown */}
          <div className="relative shrink-0">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label="Post options"
              className="w-10 h-10 flex items-center justify-center rounded-full text-zinc-400 hover:text-white hover:bg-white/10 transition cursor-pointer active:scale-90"
            >
              <MoreHorizontal className="w-5 h-5" />
            </button>

            <AnimatePresence>
              {menuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-30"
                    onClick={() => setMenuOpen(false)}
                  />
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: -4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: -4 }}
                    className="absolute right-0 top-10 w-44 rounded-2xl glass-surface border border-white/15 shadow-2xl p-1.5 z-40 text-xs"
                  >
                    <button
                      onClick={handleShare}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-zinc-300 hover:text-white hover:bg-white/10 text-left transition cursor-pointer"
                    >
                      <Share2 className="w-3.5 h-3.5" />
                      <span>Share Post</span>
                    </button>
                    <button
                      onClick={() => {
                        handleToggleBookmark();
                        setMenuOpen(false);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-zinc-300 hover:text-white hover:bg-white/10 text-left transition"
                    >
                      <Bookmark className="w-3.5 h-3.5" />
                      <span>{isBookmarked ? 'Unsave Post' : 'Save Post'}</span>
                    </button>
                    {isOwner && (
                      <>
                        <button
                          onClick={handleTogglePin}
                          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-zinc-300 hover:text-white hover:bg-white/10 text-left transition cursor-pointer"
                        >
                          <Pin className="w-3.5 h-3.5" />
                          <span>{isPinned ? 'Unpin from Profile' : 'Pin to Profile'}</span>
                        </button>
                        <button
                          onClick={handleToggleHideLikes}
                          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-zinc-300 hover:text-white hover:bg-white/10 text-left transition cursor-pointer"
                        >
                          {hideLikes ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                          <span>{hideLikes ? 'Show Like Count' : 'Hide Like Count'}</span>
                        </button>
                        <button
                          onClick={handleToggleCommentsDisabled}
                          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-zinc-300 hover:text-white hover:bg-white/10 text-left transition cursor-pointer"
                        >
                          <MessageSquareOff className="w-3.5 h-3.5" />
                          <span>{commentsDisabled ? 'Turn On Comments' : 'Turn Off Comments'}</span>
                        </button>
                        <button
                          onClick={() => {
                            setIsEditing(true);
                            setMenuOpen(false);
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-zinc-300 hover:text-white hover:bg-white/10 text-left transition cursor-pointer"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                          <span>Edit Content</span>
                        </button>
                        <button
                          onClick={() => {
                            setMenuOpen(false);
                            setDeleteConfirmOpen(true);
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-red-400 hover:text-red-300 hover:bg-red-500/10 text-left transition cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Delete Post</span>
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        onOpenReport(post.id);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-zinc-400 hover:text-red-400 hover:bg-white/5 text-left transition"
                    >
                      <Flag className="w-3.5 h-3.5" />
                      <span>Report Post</span>
                    </button>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Content body */}
        {isEditing ? (
          <div className="mb-4">
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="glass-input w-full p-3 rounded-2xl text-sm min-h-[90px] mb-2"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setIsEditing(false)}
                className="px-3 py-1.5 text-xs text-zinc-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                className="glass-button-primary px-4 py-1.5 text-xs font-semibold"
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          cleanText && (
            <div className="text-zinc-200 text-sm md:text-[15px] leading-relaxed whitespace-pre-line break-words mb-4 font-normal">
              {renderFormattedContent(cleanText)}
            </div>
          )
        )}

        {/* Post Images Carousel */}
        {post.images && post.images.length > 0 && (
          <div className="mb-4">
              <div
                className="relative rounded-2xl overflow-hidden border border-white/10 bg-black/60"
                onTouchStart={(e) => {
                  if (post.images && post.images.length > 1) {
                    touchStartXRef.current = e.touches[0].clientX;
                  }
                }}
                onTouchEnd={(e) => {
                  if (touchStartXRef.current === null || !post.images || post.images.length <= 1) return;
                  const deltaX = e.changedTouches[0].clientX - touchStartXRef.current;
                  touchStartXRef.current = null;
                  if (Math.abs(deltaX) > 40) {
                    if (deltaX < 0) {
                      setActiveImageIndex((i) => (i < post.images!.length - 1 ? i + 1 : 0));
                    } else {
                      setActiveImageIndex((i) => (i > 0 ? i - 1 : post.images!.length - 1));
                    }
                  }
                }}
              >
                <div className="relative aspect-[4/3] sm:aspect-[16/10] md:aspect-[16/9] w-full flex items-center justify-center overflow-hidden">
                  {failedImages[activeImageIndex] ? (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-zinc-900 to-black text-zinc-500 text-xs">
                      <span>Image unavailable</span>
                    </div>
                  ) : (
                    <img
                      src={post.images[activeImageIndex]}
                      alt="Post attachment"
                      loading={priorityImage ? 'eager' : 'lazy'}
                      fetchPriority={priorityImage ? 'high' : 'auto'}
                      decoding="async"
                      referrerPolicy="no-referrer"
                      onError={() => setFailedImages((prev) => ({ ...prev, [activeImageIndex]: true }))}
                      className="w-full h-full object-cover cursor-pointer md:hover:scale-[1.02] transition-transform duration-300 select-none"
                      onClick={() => handlePhotoTap(post.images![activeImageIndex])}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        if (singleTapTimerRef.current !== null) {
                          window.clearTimeout(singleTapTimerRef.current);
                          singleTapTimerRef.current = null;
                        }
                        triggerLikeIfNeeded();
                      }}
                    />
                  )}

                  {/* Double-tap floating heart burst overlay */}
                  <AnimatePresence>
                    {doubleTapHeart && (
                      <motion.div
                        initial={{ scale: 0.4, opacity: 0 }}
                        animate={{ scale: 1.15, opacity: 1 }}
                        exit={{ scale: 1.4, opacity: 0 }}
                        transition={{ duration: 0.25 }}
                        className="pointer-events-none absolute inset-0 flex items-center justify-center z-20"
                      >
                        <Heart className="w-20 h-20 fill-rose-500 stroke-white drop-shadow-[0_4px_24px_rgba(244,63,94,0.85)]" />
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {!failedImages[activeImageIndex] && (
                    <button
                      onClick={() => {
                        soundFX.playTap();
                        setLightboxImage(post.images![activeImageIndex]);
                      }}
                      aria-label="Expand image"
                      className="absolute top-2.5 right-2.5 w-9 h-9 flex items-center justify-center rounded-full glass-surface text-white/85 hover:text-white opacity-90 md:opacity-0 md:group-hover:opacity-100 transition"
                    >
                      <Maximize2 className="w-4 h-4" />
                    </button>
                  )}

                  {post.images.length > 1 && (
                    <>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveImageIndex((i) => (i > 0 ? i - 1 : post.images!.length - 1));
                        }}
                        aria-label="Previous image"
                        className="absolute left-2.5 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-full glass-surface text-white hover:bg-white/20 transition"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveImageIndex((i) => (i < post.images!.length - 1 ? i + 1 : 0));
                        }}
                        aria-label="Next image"
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-full glass-surface text-white hover:bg-white/20 transition"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>

                      <div className="absolute bottom-3 inset-x-0 flex items-center justify-center gap-1.5">
                        {post.images.map((_, idx) => (
                          <span
                            key={idx}
                            className={`h-1.5 rounded-full transition-all ${
                              idx === activeImageIndex ? 'w-4 bg-white' : 'w-1.5 bg-white/40'
                            }`}
                          />
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
          </div>
        )}

        {/* Quoted / Reposted Original Post Card */}
        {post.repost_of_id && (
          <div
            onClick={() => {
              if (post.repost_of_user) {
                soundFX.playTap();
                onOpenProfile(post.repost_of_user);
              }
            }}
            className="mb-4 p-3.5 rounded-2xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/10 transition cursor-pointer flex items-start justify-between gap-3"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-xs mb-1">
                <span className="font-semibold text-white truncate">
                  {post.repost_of_display_name || post.repost_of_user}
                </span>
                {post.repost_of_user && (
                  <span className="text-zinc-500 font-mono truncate">
                    @{post.repost_of_user}
                  </span>
                )}
              </div>
              {post.repost_of_content && (
                <p className="text-xs text-zinc-300 whitespace-pre-line break-words line-clamp-4 leading-relaxed">
                  {parsePostContent(post.repost_of_content).cleanText}
                </p>
              )}
            </div>
            {post.repost_of_image && !repostImageFailed && (
              <img
                src={post.repost_of_image}
                alt="Original post"
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                onError={() => setRepostImageFailed(true)}
                className="w-16 h-16 rounded-xl object-cover border border-white/10 shrink-0"
              />
            )}
          </div>
        )}

        {/* Action Dock */}
        <div className="flex items-center justify-between pt-2 border-t border-white/[0.06] text-zinc-400">
          <div className="flex items-center gap-1.5 sm:gap-4">
            {/* Like */}
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={handleToggleLike}
                aria-label={`Like post (${likesCount})`}
                className={`w-10 h-10 flex items-center justify-center rounded-full transition-all duration-150 cursor-pointer active:scale-90 ${
                  isLiked
                    ? 'text-rose-400 hover:bg-white/[0.06]'
                    : 'hover:text-white hover:bg-white/[0.06]'
                }`}
              >
                <Heart
                  className={`w-5 h-5 transition-transform duration-200 ${
                    likeAnimating ? 'scale-125' : 'scale-100'
                  } ${isLiked ? 'fill-rose-400 stroke-rose-400' : 'stroke-[1.8]'}`}
                />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!hideLikes || isOwner) onOpenLikedBy(post.id);
                }}
                title={hideLikes && !isOwner ? 'Like count hidden by author' : 'View likes'}
                className={`text-xs font-mono font-semibold tabular-nums text-zinc-300 hover:text-white transition px-1 py-2 min-h-[36px] ${
                  hideLikes && !isOwner ? 'cursor-default text-zinc-400 font-sans font-normal' : 'cursor-pointer'
                }`}
              >
                {hideLikes && !isOwner ? (likesCount > 0 ? 'Liked' : '') : likesCount}
              </button>
            </div>

            {/* Comments button */}
            <button
              type="button"
              onClick={handleLoadComments}
              aria-label={`Comments (${commentsCount})`}
              className="flex items-center gap-1.5 px-2 h-10 rounded-full hover:text-white hover:bg-white/[0.06] transition cursor-pointer group/cmt active:scale-95"
            >
              <MessageCircle className="w-5 h-5 stroke-[1.8] group-hover/cmt:scale-105 transition-transform" />
              <span className="text-xs font-mono font-semibold tabular-nums text-zinc-300 group-hover/cmt:text-white">
                {commentsCount}
              </span>
            </button>

            {/* Repost / Quote Popover Trigger */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  soundFX.playTap();
                  setRepostMenuOpen((v) => !v);
                }}
                aria-label={`Repost or Quote (${repostsCount})`}
                className="flex items-center gap-1.5 px-2 h-10 rounded-full hover:text-emerald-300 hover:bg-white/[0.06] transition cursor-pointer active:scale-95"
                title="Repost or Quote"
              >
                <Repeat2 className="w-5 h-5 stroke-[1.8]" />
                <span className="text-xs font-mono font-semibold tabular-nums text-zinc-300">
                  {repostsCount}
                </span>
              </button>

              <AnimatePresence>
                {repostMenuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-30"
                      onClick={() => setRepostMenuOpen(false)}
                    />
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95, y: 4 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95, y: 4 }}
                      className="absolute left-0 bottom-11 w-40 rounded-2xl glass-surface border border-white/15 shadow-2xl p-1.5 z-40 text-xs"
                    >
                      <button
                        type="button"
                        onClick={handleRepostDirect}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-zinc-200 hover:text-emerald-300 hover:bg-white/10 text-left transition cursor-pointer"
                      >
                        <Repeat2 className="w-3.5 h-3.5" />
                        <span>Repost</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRepostMenuOpen(false);
                          if (!user) {
                            openAuth('login');
                            return;
                          }
                          soundFX.playTap();
                          onQuotePost?.(post);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-zinc-200 hover:text-white hover:bg-white/10 text-left transition cursor-pointer"
                      >
                        <Quote className="w-3.5 h-3.5" />
                        <span>Quote Post</span>
                      </button>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>

            {/* Share */}
            <button
              type="button"
              onClick={handleShare}
              aria-label="Share post"
              className="w-10 h-10 flex items-center justify-center rounded-full hover:text-white hover:bg-white/[0.06] transition cursor-pointer active:scale-90"
              title="Share post"
            >
              <Share2 className="w-5 h-5 stroke-[1.8]" />
            </button>
          </div>

          {/* Bookmark */}
          <button
            type="button"
            onClick={handleToggleBookmark}
            aria-label={isBookmarked ? 'Remove bookmark' : 'Bookmark post'}
            className={`w-10 h-10 flex items-center justify-center rounded-full transition cursor-pointer active:scale-90 ${
              isBookmarked
                ? 'text-white bg-white/10 shadow-[0_0_14px_rgba(255,255,255,0.2)]'
                : 'hover:text-white hover:bg-white/[0.06]'
            }`}
            title="Bookmark"
          >
            <Bookmark
              className={`w-5 h-5 transition-transform duration-150 ${
                isBookmarked ? 'fill-white stroke-white' : 'stroke-[1.8]'
              }`}
            />
          </button>
        </div>

        {/* Expandable Comments Section */}
        <AnimatePresence>
          {commentsOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.16 }}
              className="mt-4 pt-4 border-t border-white/[0.06] flex flex-col gap-3 overflow-hidden"
            >
              <div className="flex flex-col gap-3 max-h-72 overflow-y-auto pr-1">
                {loadingComments && comments.length === 0 ? (
                  <div className="space-y-2 py-2 animate-pulse">
                    <div className="h-10 rounded-2xl bg-white/[0.04]" />
                    <div className="h-10 rounded-2xl bg-white/[0.03]" />
                  </div>
                ) : comments.length === 0 ? (
                  <div className="text-xs text-zinc-500 py-3 text-center">
                    No comments yet. Start the thoughtful discourse.
                  </div>
                ) : (
                  comments.map((cmt) => (
                    <div
                      key={cmt.id}
                      className={`flex items-start justify-between text-xs p-2.5 rounded-2xl border ${
                        cmt.parent_id
                          ? 'ml-6 bg-white/[0.04] border-white/10'
                          : 'bg-white/[0.02] border-white/5'
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        <div onClick={() => onOpenProfile(cmt.username)} className="cursor-pointer shrink-0">
                          <Avatar
                            userId={cmt.user_id}
                            name={user?.id === cmt.user_id ? user.display_name : cmt.display_name}
                            url={user?.id === cmt.user_id ? (user.avatar_url || '') : cmt.avatar_url}
                            size="xs"
                          />
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span
                              onClick={() => onOpenProfile(cmt.username)}
                              className="font-semibold text-white cursor-pointer hover:underline"
                            >
                              {user?.id === cmt.user_id ? user.display_name : cmt.display_name}
                            </span>
                            <span className="text-[10px] text-zinc-500 font-mono">
                              @{user?.id === cmt.user_id ? user.username : cmt.username}
                            </span>
                            <span className="text-[10px] text-zinc-600">•</span>
                            <span className="text-[10px] text-zinc-500 font-mono">
                              {formatTime(cmt.created_at)}
                            </span>
                          </div>
                          <div className="text-zinc-300 mt-1 whitespace-pre-wrap break-words leading-relaxed">
                            {renderFormattedContent(cmt.content)}
                          </div>
                          <div className="mt-1.5 flex items-center gap-4 text-[11px] text-zinc-500">
                            <button
                              type="button"
                              onClick={() => handleToggleCommentLike(cmt)}
                              className={`inline-flex items-center gap-1 transition cursor-pointer ${
                                cmt.is_liked ? 'text-rose-400 font-semibold' : 'hover:text-white'
                              }`}
                            >
                              <Heart className={`w-3 h-3 ${cmt.is_liked ? 'fill-rose-400' : ''}`} />
                              <span className="tabular-nums">{cmt.likes_count > 0 ? cmt.likes_count : 'Like'}</span>
                            </button>
                            {!commentsDisabled && (
                              <button
                                type="button"
                                onClick={() => {
                                  setReplyTarget({ id: cmt.id, username: cmt.username });
                                  setCommentText(`@${cmt.username} `);
                                  window.setTimeout(() => commentInputRef.current?.focus(), 40);
                                }}
                                className="hover:text-white transition cursor-pointer"
                              >
                                Reply
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      {user && user.id === cmt.user_id && (
                        <button
                          type="button"
                          onClick={() => setCommentToDeleteId(cmt.id)}
                          className="w-8 h-8 flex items-center justify-center rounded-full text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition shrink-0"
                          title="Delete comment"
                          aria-label="Delete comment"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>

              {/* Comment Form */}
              {commentsDisabled ? (
                <div className="py-2.5 px-3.5 rounded-2xl bg-white/[0.03] border border-white/10 text-center text-xs text-zinc-400">
                  Commenting is turned off for this post.
                </div>
              ) : (
                <form onSubmit={handleAddComment} className="flex flex-col gap-2 pt-2">
                  {replyTarget && (
                    <div className="flex items-center justify-between text-xs text-zinc-300 bg-white/5 px-3 py-1.5 rounded-xl">
                      <span>Replying to @{replyTarget.username}</span>
                      <button
                        type="button"
                        onClick={() => setReplyTarget(null)}
                        aria-label="Cancel reply"
                        className="w-7 h-7 flex items-center justify-center rounded-full text-zinc-400 hover:text-white hover:bg-white/10 transition"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <input
                      ref={commentInputRef}
                      type="text"
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      placeholder={user ? 'Contribute your perspective...' : 'Sign in to comment...'}
                      disabled={!user}
                      className="glass-input flex-1 px-4 py-2.5 rounded-2xl text-xs"
                    />
                    <button
                      type="submit"
                      disabled={!user || !commentText.trim()}
                      aria-label="Submit comment"
                      className="glass-button-primary w-10 h-10 flex items-center justify-center rounded-full disabled:opacity-40 cursor-pointer active:scale-90 transition shrink-0"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                </form>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </article>

      {/* ================= ZOOMABLE LIGHTBOX IMAGE MODAL ================= */}
      <ZoomableImageLightbox
        src={lightboxImage}
        alt="Post photo"
        onClose={() => setLightboxImage(null)}
      />

      {/* ================= DELETE POST & COMMENT WARNING POP-UPS ================= */}
      <WarningPopup
        open={deleteConfirmOpen}
        title="Delete post?"
        message="This post and its interactions will be permanently removed."
        confirmLabel="Delete"
        tone="danger"
        loading={deletingPost}
        loadingLabel="Deleting..."
        onCancel={() => !deletingPost && setDeleteConfirmOpen(false)}
        onConfirm={handleDeletePost}
      />

      <WarningPopup
        open={!!commentToDeleteId}
        title="Delete comment?"
        message="This comment will be permanently removed."
        confirmLabel="Delete"
        tone="danger"
        onCancel={() => setCommentToDeleteId(null)}
        onConfirm={() => {
          const targetId = commentToDeleteId;
          setCommentToDeleteId(null);
          if (targetId) handleDeleteComment(targetId);
        }}
      />

      {/* ================= SHARE POST MODAL ================= */}
      <AnimatePresence>
        {shareModalOpen && (
          <SharePostModal
            post={post}
            onClose={() => setShareModalOpen(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
};
