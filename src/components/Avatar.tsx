import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';

export function useUserPresence(userId?: string | null, enabled = true): boolean {
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    enabled && userId ? api.getCachedUserPresence(userId) : false
  );

  useEffect(() => {
    if (!enabled || !userId) {
      setIsOnline(false);
      return;
    }
    return api.subscribeUserPresence(userId, setIsOnline);
  }, [userId, enabled]);

  return isOnline;
}

interface AvatarProps {
  name?: string;
  url?: string | null;
  userId?: string | null;
  showPresence?: boolean;
  presencePosition?: 'bottom-right' | 'top-right';
  size?: '2xs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

export const Avatar: React.FC<AvatarProps> = ({
  name = 'User',
  url,
  userId,
  showPresence = true,
  presencePosition = 'bottom-right',
  size = 'md',
  className = '',
}) => {
  const [imgFailed, setImgFailed] = useState(false);
  const shouldTrackPresence = Boolean(userId && showPresence);
  const isOnline = useUserPresence(userId, shouldTrackPresence);

  useEffect(() => {
    setImgFailed(false);
  }, [url]);

  const sizeClasses = {
    '2xs': 'w-[18px] h-[18px] text-[8px]',
    xs: 'w-6 h-6 text-[10px]',
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-xs',
    lg: 'w-12 h-12 text-sm',
    xl: 'w-24 h-24 text-2xl',
  };

  const dotSizeClasses = {
    '2xs': 'w-2 h-2 ring-[1.5px]',
    xs: 'w-2 h-2 ring-[1.5px]',
    sm: 'w-2.5 h-2.5 ring-2',
    md: 'w-2.5 h-2.5 ring-2',
    lg: 'w-3 h-3 ring-2',
    xl: 'w-4 h-4 ring-[3px]',
  };

  const dotPositionClasses =
    presencePosition === 'top-right'
      ? size === '2xs' || size === 'xs'
        ? '-top-0.5 -right-0.5'
        : 'top-0 right-0'
      : size === '2xs' || size === 'xs'
      ? '-bottom-0.5 -right-0.5'
      : size === 'xl'
      ? 'bottom-1 right-1'
      : 'bottom-0 right-0';

  const getInitials = (str: string) => {
    const parts = str.trim().split(/\s+/);
    if (parts.length === 0 || !parts[0]) return 'U';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  const initials = getInitials(name);

  const hasValidImage =
    !imgFailed &&
    url &&
    url.trim() &&
    !url.includes('images.unsplash.com/photo-1534528741775-53994a69daeb');

  const avatarNode = hasValidImage ? (
    <img
      src={url!}
      alt={name}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setImgFailed(true)}
      className={`${sizeClasses[size]} rounded-full object-cover border border-white/20 shrink-0 ${className}`}
    />
  ) : (
    <div
      className={`${sizeClasses[size]} rounded-full bg-gradient-to-b from-zinc-800 to-zinc-950 border border-white/20 flex items-center justify-center font-mono font-bold text-white tracking-wider shrink-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] select-none ${className}`}
    >
      <span>{initials}</span>
    </div>
  );

  if (!shouldTrackPresence) {
    return avatarNode;
  }

  return (
    <div className="relative inline-flex shrink-0">
      {avatarNode}
      {isOnline && (
        <span
          title="Online"
          aria-label="Online"
          className={`absolute ${dotPositionClasses} ${dotSizeClasses[size]} rounded-full bg-emerald-400 ring-black shadow-[0_0_8px_rgba(52,211,153,0.75)] pointer-events-none`}
        />
      )}
    </div>
  );
};
