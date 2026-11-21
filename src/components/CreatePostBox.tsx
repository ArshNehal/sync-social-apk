import React, { useState } from 'react';
import { Image, X, Send, Quote } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Post } from '../types';
import { Avatar } from './Avatar';
import { soundFX } from '../lib/sounds';
import { parsePostContent } from '../lib/postMeta';

interface CreatePostBoxProps {
  onPostCreated: (post: Post) => void;
  isModal?: boolean;
  onClose?: () => void;
  quotePost?: Post | null;
}

export const CreatePostBox: React.FC<CreatePostBoxProps> = ({
  onPostCreated,
  isModal = false,
  onClose,
  quotePost = null,
}) => {
  const { user, openAuth, showToast, brandName } = useAuth();
  const [content, setContent] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  React.useEffect(() => {
    if (!isModal || !onClose) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isModal, onClose, isSubmitting]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const list = Array.from(files);
    e.target.value = '';
    setUploadingCount((c) => c + list.length);

    list.forEach((file) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64 = reader.result as string;
          const res = await api.uploadImage(base64);
          setImages((prev) => [...prev, res.url]);
        } catch (err) {
          showToast('Image upload failed');
        } finally {
          setUploadingCount((c) => Math.max(0, c - 1));
        }
      };
      reader.onerror = () => {
        setUploadingCount((c) => Math.max(0, c - 1));
      };
      reader.readAsDataURL(file);
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      openAuth('login');
      return;
    }
    const rawContent = content.trim();
    const attachedImages = [...images];
    if (!rawContent && attachedImages.length === 0 && !quotePost) {
      showToast('Please add text or an image');
      return;
    }

    setIsSubmitting(true);
    let optimisticTriggered = false;
    try {
      await api.createPost(rawContent, attachedImages, quotePost, (optimisticPost) => {
        optimisticTriggered = true;
        soundFX.playSuccess();
        onPostCreated(optimisticPost);
        setContent('');
        setImages([]);
        setIsSubmitting(false);
        showToast(quotePost ? 'Quote posted to SYNC' : `Published to ${brandName || 'SYNC'}`);
        if (isModal && onClose) onClose();
      });
    } catch (err: any) {
      if (optimisticTriggered) {
        setContent(rawContent);
        setImages(attachedImages);
      }
      showToast(err?.message || 'Failed to publish post');
      setIsSubmitting(false);
    }
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const containerContent = (
    <div
      className={`glass-card rounded-3xl p-4 sm:p-5 border border-white/[0.12] transition-colors duration-200 ${
        isFocused ? 'border-white/35 shadow-[0_8px_30px_rgba(255,255,255,0.08)]' : ''
      }`}
    >
      <div className="flex items-start gap-3.5">
        {user ? (
          <Avatar
            userId={user.id}
            name={user.display_name}
            url={user.avatar_url}
            size="md"
            className="mt-0.5"
          />
        ) : null}

        <div className="flex-1 min-w-0">
          <textarea
            value={content}
            maxLength={1980}
            onChange={(e) => setContent(e.target.value)}
            onFocus={() => {
              if (!user) openAuth('login');
              else setIsFocused(true);
            }}
            onBlur={() => setIsFocused(false)}
            placeholder={
              quotePost
                ? `Add your thoughts on @${quotePost.username}'s post...`
                : user
                ? 'Share a genuine thought, photograph, or reflection...'
                : 'Sign in to join the conversation...'
            }
            rows={isFocused || content || images.length > 0 || isModal ? 4 : 2}
            className="w-full bg-transparent text-white placeholder-zinc-500 text-sm md:text-[15px] resize-none outline-none leading-relaxed transition-all"
          />

          {/* Embedded Quote Target Preview */}
          {quotePost && (
            <div className="my-2.5 p-3 rounded-2xl bg-white/[0.04] border border-white/15 flex items-start gap-2.5">
              <Quote className="w-3.5 h-3.5 text-zinc-400 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="font-semibold text-white truncate">{quotePost.display_name}</span>
                  <span className="text-zinc-500 font-mono truncate">@{quotePost.username}</span>
                </div>
                <p className="text-xs text-zinc-300 mt-1 line-clamp-2">
                  {parsePostContent(quotePost.content || '').cleanText || 'Shared media post'}
                </p>
              </div>
              {quotePost.images?.[0] && (
                <img
                  src={quotePost.images[0]}
                  alt="Quoted preview"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = 'none';
                  }}
                  className="w-11 h-11 rounded-xl object-cover border border-white/10 shrink-0"
                />
              )}
            </div>
          )}

          {/* Uploaded images previews */}
          <AnimatePresence>
            {images.length > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="my-3 grid grid-cols-2 md:grid-cols-3 gap-2.5"
              >
                {images.map((img, i) => (
                  <motion.div
                    key={i}
                    layout
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    className="relative aspect-[16/10] rounded-2xl overflow-hidden border border-white/15 group"
                  >
                    <img src={img} alt="attachment" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removeImage(i)}
                      className="absolute top-2 right-2 w-8 h-8 flex items-center justify-center rounded-full bg-black/70 text-white hover:bg-black transition"
                      aria-label={`Remove image ${i + 1}`}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </motion.div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Action Row */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-white/[0.08]">
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 px-3.5 min-h-[38px] rounded-full glass-surface text-xs text-zinc-300 hover:text-white hover:bg-white/10 cursor-pointer transition active:scale-95 shadow-sm">
                <Image className="w-3.5 h-3.5" />
                <span>{uploadingCount > 0 ? 'Uploading...' : 'Add Image'}</span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>

            <div className="flex items-center gap-3">
              {content.length > 0 && (
                <span className={`text-[11px] font-mono tabular-nums ${content.length > 1800 ? 'text-amber-400' : 'text-zinc-500'}`}>
                  {content.length}/1980
                </span>
              )}
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isSubmitting || uploadingCount > 0 || (!content.trim() && images.length === 0 && !quotePost)}
                className="glass-button-primary sheen-glow px-5 min-h-[40px] text-xs font-semibold flex items-center gap-2 disabled:opacity-40 cursor-pointer active:scale-95 transition shadow-md"
              >
                <span>{isSubmitting ? 'Posting...' : quotePost ? 'Quote Post' : 'Publish'}</span>
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  if (!isModal) {
    return <div className="mb-6">{containerContent}</div>;
  }

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-2xl flex items-center justify-center p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget && onClose) onClose();
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-lg relative max-h-[90dvh] overflow-y-auto my-auto"
      >
        <div className="flex items-center justify-between mb-2.5 px-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            {quotePost ? 'Quote Post' : 'Create Post'}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-white/10 text-zinc-300 hover:text-white hover:bg-white/20 transition"
            aria-label="Close create post"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {containerContent}
      </motion.div>
    </div>
  );
};
