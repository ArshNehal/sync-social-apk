import React, { useRef, useEffect } from 'react';
import {
  Home,
  Compass,
  Search,
  MessageSquare,
  Bell,
  Bookmark,
  User as UserIcon,
  Settings,
  Plus,
  Sparkles,
  UserPlus,
  Smartphone,
  ArrowLeftRight,
} from 'lucide-react';
import { motion } from 'motion/react';
import { Logo } from './Logo';
import { LeaderboardIcon } from './LeaderboardIcon';
import { useAuth } from '../context/AuthContext';
import { Avatar } from './Avatar';
import { SpLevelProgressBar } from './SpLevelProgressBar';
import { NativeBridge } from '../lib/native';
import { soundFX } from '../lib/sounds';

export type ActiveTab =
  | 'home'
  | 'explore'
  | 'leaderboard'
  | 'search'
  | 'messages'
  | 'notifications'
  | 'bookmarks'
  | 'profile'
  | 'settings';

interface NavigationProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  onOpenCreatePost: () => void;
  onOpenProfile: (username: string) => void;
  onOpenInvite: () => void;
  onOpenInstallApp?: () => void;
}

export const Navigation: React.FC<NavigationProps> = ({
  activeTab,
  onSelectTab,
  onOpenCreatePost,
  onOpenProfile,
  onOpenInvite,
  onOpenInstallApp,
}) => {
  const { user, counts, openAuth, openAccountSwitcher } = useAuth();

  // Long-press state for mobile Profile dock button -> Account Switcher
  const holdTimerRef = useRef<number | null>(null);
  const holdResetTimerRef = useRef<number | null>(null);
  const holdTriggeredRef = useRef(false);
  const holdStartPosRef = useRef<{ x: number; y: number } | null>(null);

  const clearHoldTimer = () => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      clearHoldTimer();
      if (holdResetTimerRef.current !== null) {
        window.clearTimeout(holdResetTimerRef.current);
      }
    };
  }, []);

  const navItems: Array<{
    id: ActiveTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number;
    requireAuth?: boolean;
  }> = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'explore', label: 'Explore', icon: Compass },
    { id: 'leaderboard', label: 'Leaderboard', icon: LeaderboardIcon },
    { id: 'search', label: 'Search', icon: Search },
    { id: 'messages', label: 'Messages', icon: MessageSquare, badge: counts.unreadMessages, requireAuth: true },
    { id: 'notifications', label: 'Alerts', icon: Bell, badge: counts.unreadNotifications, requireAuth: true },
    { id: 'bookmarks', label: 'Saved', icon: Bookmark, requireAuth: true },
    { id: 'profile', label: 'Profile', icon: UserIcon, requireAuth: true },
    { id: 'settings', label: 'Settings', icon: Settings, requireAuth: true },
  ];

  const handleNavClick = (id: ActiveTab, requireAuth?: boolean) => {
    NativeBridge.triggerHaptic('light');
    soundFX.playTap();
    if (requireAuth && !user) {
      openAuth('login');
      return;
    }
    if (id === 'profile' && user) {
      onOpenProfile(user.username);
    } else {
      onSelectTab(id);
    }
  };

  const handleProfilePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    clearHoldTimer();
    if (holdResetTimerRef.current !== null) {
      window.clearTimeout(holdResetTimerRef.current);
      holdResetTimerRef.current = null;
    }
    holdTriggeredRef.current = false;
    holdStartPosRef.current = { x: e.clientX, y: e.clientY };
    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = null;
      holdTriggeredRef.current = true;
      NativeBridge.triggerHaptic('medium');
      soundFX.playTap();
      openAccountSwitcher();
    }, 420);
  };

  const handleProfilePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!holdStartPosRef.current || holdTimerRef.current === null) return;
    const dx = Math.abs(e.clientX - holdStartPosRef.current.x);
    const dy = Math.abs(e.clientY - holdStartPosRef.current.y);
    if (dx > 12 || dy > 12) {
      clearHoldTimer();
    }
  };

  const handleProfilePointerUpOrCancel = () => {
    clearHoldTimer();
    holdStartPosRef.current = null;
    // If modal overlay swallowed the trailing click, reset the flag so the next tap works normally
    if (holdTriggeredRef.current) {
      if (holdResetTimerRef.current !== null) {
        window.clearTimeout(holdResetTimerRef.current);
      }
      holdResetTimerRef.current = window.setTimeout(() => {
        holdTriggeredRef.current = false;
        holdResetTimerRef.current = null;
      }, 280);
    }
  };

  const handleProfileClick = () => {
    if (holdTriggeredRef.current) {
      holdTriggeredRef.current = false;
      if (holdResetTimerRef.current !== null) {
        window.clearTimeout(holdResetTimerRef.current);
        holdResetTimerRef.current = null;
      }
      return;
    }
    handleNavClick('profile', true);
  };

  const mobileSubpageMeta: Partial<Record<ActiveTab, { title: string }>> = {
    explore: { title: 'Explore' },
    leaderboard: { title: 'SP Leaderboard' },
    search: { title: 'Search' },
    notifications: { title: 'Activity & Alerts' },
    bookmarks: { title: 'Saved Archive' },
    settings: { title: 'Settings' },
  };
  const currentMobileSubpage = mobileSubpageMeta[activeTab];

  return (
    <>
      {/* ================= DESKTOP SIDEBAR ================= */}
      <aside className="hidden md:flex flex-col justify-between gap-3 w-64 lg:w-72 fixed inset-y-0 left-0 p-4 lg:p-5 glass-nav border-r border-white/[0.08] z-30 select-none">
        <div className="flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto no-scrollbar pr-0.5">
          {/* Brand header (always visible on desktop sidebar; mobile header is Home-only) */}
          <button
            type="button"
            onClick={() => {
              soundFX.playTap();
              onSelectTab('home');
            }}
            className="cursor-pointer pt-1 px-3 group flex items-center justify-between shrink-0 text-left"
          >
            <Logo size="md" />
          </button>

          {/* Navigation Links */}
          <nav className="flex flex-col gap-0.5">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNavClick(item.id, item.requireAuth)}
                  className={`relative flex items-center justify-between px-3.5 py-2 rounded-2xl text-sm font-medium transition-colors duration-150 group overflow-hidden select-none cursor-pointer active:scale-[0.98] ${
                    isActive
                      ? 'text-white font-semibold'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  {isActive && (
                    <motion.div
                      layoutId="active-nav-pill"
                      className="absolute inset-0 bg-white/10 rounded-2xl border border-white/15 shadow-[0_4px_20px_rgba(255,255,255,0.06)]"
                      transition={{ type: 'spring', stiffness: 560, damping: 38 }}
                    />
                  )}

                  <div className="relative z-10 flex items-center gap-3.5 whitespace-nowrap">
                    <Icon
                      className={`w-5 h-5 transition-transform duration-150 md:group-hover:scale-105 ${
                        isActive ? 'text-white' : 'text-zinc-400 group-hover:text-zinc-200'
                      }`}
                    />
                    <span>{item.label}</span>
                  </div>

                  {item.badge !== undefined && item.badge > 0 && (
                    <span className="relative z-10 bg-white text-black font-bold tabular-nums text-[11px] px-2 py-0.5 rounded-full shadow-[0_0_10px_rgba(255,255,255,0.3)]">
                      {item.badge > 99 ? '99+' : item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Current user SP Level progress indicator beneath navigation */}
          {user && (
            <SpLevelProgressBar
              variant="sidebar"
              onOpenLeaderboard={() => handleNavClick('leaderboard')}
            />
          )}

          {/* Create Post Glass Button */}
          <button
            type="button"
            onClick={() => {
              if (!user) {
                openAuth('login');
              } else {
                onOpenCreatePost();
              }
            }}
            className="glass-button-primary sheen-glow flex items-center justify-center gap-2.5 py-2.5 px-4 text-sm font-semibold tracking-wide w-full group cursor-pointer active:scale-[0.98] whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4 transition-transform md:group-hover:rotate-90 duration-200" />
            <span>Publish Post</span>
          </button>

          {/* Invite & Connect Button */}
          <button
            type="button"
            onClick={onOpenInvite}
            className="flex items-center justify-center gap-2 py-2 px-3 rounded-2xl glass-surface-hover text-xs font-semibold text-zinc-300 hover:text-white border border-white/10 w-full cursor-pointer transition active:scale-[0.98] whitespace-nowrap shrink-0"
          >
            <UserPlus className="w-4 h-4 text-zinc-300" />
            <span>Invite & Connect</span>
          </button>

          {/* Install / Get APK Button */}
          {onOpenInstallApp && (
            <button
              type="button"
              onClick={onOpenInstallApp}
              className="flex items-center justify-center gap-2 py-2 px-3 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] text-xs font-medium text-zinc-400 hover:text-white border border-white/5 w-full cursor-pointer transition active:scale-[0.98] whitespace-nowrap shrink-0"
            >
              <Smartphone className="w-3.5 h-3.5 text-zinc-400" />
              <span>Get Android App</span>
            </button>
          )}
        </div>

        {/* User profile dock / Auth CTA */}
        <div className="pt-3 border-t border-white/[0.08] shrink-0">
          {user ? (
            <div className="flex items-center justify-between gap-2 p-2 rounded-2xl bg-white/[0.03] border border-white/5 hover:border-white/15 transition-all">
              <button
                type="button"
                onClick={() => onOpenProfile(user.username)}
                className="flex items-center gap-3 cursor-pointer min-w-0 flex-1 text-left"
              >
                <Avatar
                  userId={user.id}
                  name={user.display_name}
                  url={user.avatar_url}
                  size="sm"
                />
                <div className="truncate">
                  <div className="text-sm font-medium text-white truncate flex items-center gap-1">
                    <span className="truncate">{user.display_name}</span>
                    {user.is_verified ? (
                      <Sparkles className="w-3.5 h-3.5 text-zinc-300 shrink-0 inline" />
                    ) : null}
                  </div>
                  <div className="text-xs text-zinc-400 font-mono truncate">@{user.username}</div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => {
                  soundFX.playTap();
                  openAccountSwitcher();
                }}
                title="Switch or add account"
                aria-label="Switch or add account"
                className="w-9 h-9 flex items-center justify-center rounded-xl text-zinc-400 hover:text-white hover:bg-white/10 transition cursor-pointer shrink-0"
              >
                <ArrowLeftRight className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => openAuth('register')}
                className="w-full py-2.5 px-4 bg-white text-black rounded-xl text-xs font-semibold tracking-wide hover:bg-zinc-200 transition"
              >
                Create Account
              </button>
              <button
                type="button"
                onClick={() => openAuth('login')}
                className="w-full py-2 px-4 text-xs text-zinc-300 hover:text-white rounded-xl hover:bg-white/5 transition"
              >
                Sign In
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* ================= DESKTOP TOP-RIGHT AUTH BAR (Home only) ================= */}
      {!user && activeTab === 'home' && (
        <div className="hidden md:flex fixed top-4 right-6 z-40 items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              soundFX.playTap();
              openAuth('login');
            }}
            className="glass-pill px-4 py-2 rounded-full text-xs font-semibold text-zinc-200 hover:text-white whitespace-nowrap"
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              soundFX.playTap();
              openAuth('register');
            }}
            className="glass-button-primary sheen-glow px-4 py-2 text-xs font-semibold tracking-wide whitespace-nowrap"
          >
            Create Account
          </button>
        </div>
      )}

      {/* ================= MOBILE TOP HEADER (Logo strictly on Home page) ================= */}
      {activeTab === 'home' ? (
        <header className="md:hidden fixed top-0 inset-x-0 min-h-[50px] pt-[env(safe-area-inset-top)] glass-nav z-40 px-2.5 sm:px-4 grid grid-cols-[auto_1fr_auto] items-center gap-2">
          <button
            type="button"
            onClick={() => {
              soundFX.playTap();
              onSelectTab('home');
            }}
            aria-label="SYNC Home"
            className="cursor-pointer shrink-0 flex items-center min-h-[40px]"
          >
            <Logo size="sm" />
          </button>

          {/* Center Top Search Trigger */}
          <div className="flex justify-center min-w-0">
            <button
              type="button"
              onClick={() => handleNavClick('search')}
              className="w-full max-w-[160px] sm:max-w-[240px] min-h-[36px] px-3 rounded-full border text-xs flex items-center justify-center gap-1.5 transition cursor-pointer truncate whitespace-nowrap bg-white/[0.06] hover:bg-white/[0.11] border-white/10 text-zinc-300 hover:text-white"
              title="Search"
              aria-label="Search"
            >
              <Search className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate font-medium">Search</span>
            </button>
          </div>

          <div className="flex items-center justify-end gap-0.5 sm:gap-1 shrink-0">
            <button
              type="button"
              onClick={() => handleNavClick('leaderboard')}
              className="w-10 h-10 flex items-center justify-center rounded-xl transition cursor-pointer active:scale-95 text-zinc-300 hover:bg-white/10"
              title="SP Leaderboard"
              aria-label="SP Leaderboard"
            >
              <LeaderboardIcon className="w-[18px] h-[18px]" />
            </button>
            {user ? (
              <>
                {onOpenInstallApp && (
                  <button
                    type="button"
                    onClick={onOpenInstallApp}
                    className="hidden min-[520px]:inline-flex w-10 h-10 items-center justify-center rounded-xl text-zinc-300 hover:bg-white/10"
                    title="Get Android App / APK"
                    aria-label="Get Android App"
                  >
                    <Smartphone className="w-[18px] h-[18px]" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={onOpenInvite}
                  className="hidden min-[440px]:inline-flex w-10 h-10 items-center justify-center rounded-xl text-zinc-300 hover:bg-white/10"
                  title="Invite & Connect"
                  aria-label="Invite and connect"
                >
                  <UserPlus className="w-[18px] h-[18px]" />
                </button>
                <button
                  type="button"
                  onClick={() => handleNavClick('notifications', true)}
                  className="w-10 h-10 flex items-center justify-center relative rounded-xl transition active:scale-95 text-zinc-300 hover:bg-white/10"
                  title="Alerts"
                  aria-label="Alerts"
                >
                  <Bell className="w-[18px] h-[18px]" />
                  {counts.unreadNotifications > 0 && (
                    <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-white" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => handleNavClick('bookmarks', true)}
                  className="w-10 h-10 flex items-center justify-center rounded-xl transition cursor-pointer active:scale-95 text-zinc-300 hover:bg-white/10"
                  title="Saved"
                  aria-label="Saved"
                >
                  <Bookmark className="w-[18px] h-[18px]" />
                </button>
                <button
                  type="button"
                  onClick={() => handleNavClick('settings', true)}
                  className="w-10 h-10 flex items-center justify-center rounded-xl transition cursor-pointer active:scale-95 text-zinc-300 hover:bg-white/10"
                  title="Settings"
                  aria-label="Settings"
                >
                  <Settings className="w-[18px] h-[18px]" />
                </button>
              </>
            ) : (
              <>
                {onOpenInstallApp && (
                  <button
                    type="button"
                    onClick={onOpenInstallApp}
                    className="hidden min-[480px]:inline-flex w-10 h-10 items-center justify-center rounded-xl text-zinc-300 hover:bg-white/10"
                    title="Get Android App / APK"
                    aria-label="Get Android App"
                  >
                    <Smartphone className="w-4 h-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => openAuth('login')}
                  className="glass-pill px-2.5 sm:px-3 min-h-[36px] rounded-full text-[11px] sm:text-xs font-semibold text-zinc-200 hover:text-white whitespace-nowrap"
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => openAuth('register')}
                  className="glass-button-primary px-3 sm:px-3.5 min-h-[36px] text-[11px] sm:text-xs font-semibold whitespace-nowrap"
                >
                  Join
                </button>
              </>
            )}
          </div>
        </header>
      ) : currentMobileSubpage ? (
        <header className="md:hidden fixed top-0 inset-x-0 min-h-[48px] pt-[env(safe-area-inset-top)] glass-nav z-40 px-2.5 sm:px-4 grid grid-cols-[40px_1fr_auto] items-center gap-2">
          <button
            type="button"
            onClick={() => handleNavClick('home')}
            className="w-10 h-10 flex items-center justify-center rounded-xl text-zinc-300 hover:text-white hover:bg-white/10 transition active:scale-95"
            aria-label="Back to Home"
            title="Back to Home"
          >
            <Home className="w-[18px] h-[18px]" />
          </button>

          <h1 className="text-sm font-semibold text-white text-center truncate tracking-wide">
            {currentMobileSubpage.title}
          </h1>

          <div className="flex items-center justify-end gap-0.5 min-w-[40px]">
            {activeTab !== 'leaderboard' && (
              <button
                type="button"
                onClick={() => handleNavClick('leaderboard')}
                className="w-10 h-10 flex items-center justify-center rounded-xl text-zinc-300 hover:text-white hover:bg-white/10 transition active:scale-95"
                aria-label="SP Leaderboard"
                title="SP Leaderboard"
              >
                <LeaderboardIcon className="w-[18px] h-[18px]" />
              </button>
            )}
            {user && activeTab !== 'settings' && (
              <button
                type="button"
                onClick={() => handleNavClick('settings', true)}
                className="w-10 h-10 flex items-center justify-center rounded-xl text-zinc-300 hover:text-white hover:bg-white/10 transition active:scale-95"
                aria-label="Settings"
                title="Settings"
              >
                <Settings className="w-[18px] h-[18px]" />
              </button>
            )}
          </div>
        </header>
      ) : null}

      {/* ================= MOBILE / VERTICAL TABLET BOTTOM DOCK ================= */}
      <nav
        aria-label="Primary mobile navigation"
        className="md:hidden fixed bottom-[max(0.45rem,env(safe-area-inset-bottom))] inset-x-2.5 sm:inset-x-4 h-[52px] glass-dock rounded-full z-40 px-2 sm:px-4 grid grid-cols-5 items-center"
      >
        <button
          type="button"
          onClick={() => handleNavClick('home')}
          className={`flex flex-col items-center justify-center gap-0.5 min-h-[44px] rounded-2xl transition cursor-pointer active:scale-95 whitespace-nowrap ${activeTab === 'home' ? 'text-white bg-white/10 shadow-sm' : 'text-zinc-400 hover:text-zinc-200'}`}
          title="Home"
          aria-label="Home"
        >
          <Home className="w-[18px] h-[18px]" />
          <span className="text-[10px] font-medium leading-none">Home</span>
        </button>

        <button
          type="button"
          onClick={() => handleNavClick('explore')}
          className={`flex flex-col items-center justify-center gap-0.5 min-h-[44px] rounded-2xl transition cursor-pointer active:scale-95 whitespace-nowrap ${activeTab === 'explore' ? 'text-white bg-white/10 shadow-sm' : 'text-zinc-400 hover:text-zinc-200'}`}
          title="Explore"
          aria-label="Explore"
        >
          <Compass className="w-[18px] h-[18px]" />
          <span className="text-[10px] font-medium leading-none">Explore</span>
        </button>

        {/* Floating Add Post Icon */}
        <div className="flex items-center justify-center">
          <button
            type="button"
            onClick={() => {
              NativeBridge.triggerHaptic('medium');
              soundFX.playTap();
              if (!user) openAuth('login');
              else onOpenCreatePost();
            }}
            className="w-11 h-11 flex items-center justify-center bg-white text-black rounded-full shadow-[0_0_20px_rgba(255,255,255,0.45)] transition cursor-pointer shrink-0 active:scale-90"
            title="Publish Post"
            aria-label="Publish Post"
          >
            <Plus className="w-5 h-5 stroke-[2.5]" />
          </button>
        </div>

        <button
          type="button"
          onClick={() => handleNavClick('messages', true)}
          className={`relative flex flex-col items-center justify-center gap-0.5 min-h-[44px] rounded-2xl transition cursor-pointer active:scale-95 whitespace-nowrap ${activeTab === 'messages' ? 'text-white bg-white/10 shadow-sm' : 'text-zinc-400 hover:text-zinc-200'}`}
          title="Messages"
          aria-label="Messages"
        >
          <div className="relative">
            <MessageSquare className="w-[18px] h-[18px]" />
            {counts.unreadMessages > 0 && (
              <span className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-white" />
            )}
          </div>
          <span className="text-[10px] font-medium leading-none">Messages</span>
        </button>

        <button
          type="button"
          onPointerDown={handleProfilePointerDown}
          onPointerMove={handleProfilePointerMove}
          onPointerUp={handleProfilePointerUpOrCancel}
          onPointerCancel={handleProfilePointerUpOrCancel}
          onContextMenu={(e) => e.preventDefault()}
          onClick={handleProfileClick}
          className={`flex flex-col items-center justify-center gap-0.5 min-h-[44px] rounded-2xl transition cursor-pointer active:scale-95 whitespace-nowrap select-none touch-manipulation ${activeTab === 'profile' ? 'text-white bg-white/10 shadow-sm' : 'text-zinc-400 hover:text-zinc-200'}`}
          title="Profile (Hold to switch account)"
          aria-label="Profile — hold to switch accounts"
        >
          {user ? (
            <Avatar
              userId={user.id}
              name={user.display_name}
              url={user.avatar_url}
              size="2xs"
              className={activeTab === 'profile' ? 'border-white' : 'border-white/30'}
            />
          ) : (
            <UserIcon className="w-[18px] h-[18px]" />
          )}
          <span className="text-[10px] font-medium leading-none">Profile</span>
        </button>
      </nav>
    </>
  );
};
