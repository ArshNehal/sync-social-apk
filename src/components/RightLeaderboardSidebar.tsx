import React, { useState, useEffect, useCallback } from 'react';
import { Clock, CheckCircle2, Circle, Sparkles } from 'lucide-react';
import { LeaderboardEntry } from '../types';
import { api, getLeaderboardEpochInfo } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Avatar } from './Avatar';
import { LeaderboardIcon } from './LeaderboardIcon';
import { soundFX } from '../lib/sounds';
import type { ActiveTab } from './Navigation';

interface RightLeaderboardSidebarProps {
  activeTab: ActiveTab;
  onOpenProfile: (username: string) => void;
  onOpenLeaderboard: () => void;
  onOpenCreatePost?: () => void;
}

function formatMiniCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export const RightLeaderboardSidebar: React.FC<RightLeaderboardSidebarProps> = ({
  activeTab,
  onOpenProfile,
  onOpenLeaderboard,
  onOpenCreatePost,
}) => {
  const { user } = useAuth();
  const [entries, setEntries] = useState<LeaderboardEntry[]>(
    () => api.getCachedLeaderboard()?.entries || []
  );
  const [myEntry, setMyEntry] = useState<LeaderboardEntry | null>(null);
  const [epochInfo, setEpochInfo] = useState(() => getLeaderboardEpochInfo());

  const loadLeaders = useCallback(
    async (force = false) => {
      try {
        const [boardRes, meRes] = await Promise.all([
          api.getLeaderboard(force),
          user ? api.getMySyncPoints() : Promise.resolve(null),
        ]);
        setEntries(boardRes.entries);
        if (meRes) setMyEntry(meRes);
      } catch {
        // Keep cached snapshot if offline
      }
    },
    [user?.id]
  );

  useEffect(() => {
    loadLeaders(false);
  }, [loadLeaders]);

  useEffect(() => {
    const unsubBoard = api.subscribeLeaderboard((liveEntries) => {
      setEntries(liveEntries);
    });
    const unsubMe = user?.id
      ? api.subscribeMySyncPoints(user.id, (entry) => {
          setMyEntry(entry);
        })
      : () => {};

    const onSpUpdated = (e: Event) => {
      const detail = (e as CustomEvent<LeaderboardEntry>).detail;
      if (detail) {
        setMyEntry(detail);
        setEntries((prev) => {
          const exists = prev.some((item) => item.user_id === detail.user_id);
          const updated = exists
            ? prev.map((item) => (item.user_id === detail.user_id ? detail : item))
            : [...prev, detail];
          return updated.sort((a, b) => b.points - a.points);
        });
      } else {
        loadLeaders(false);
      }
    };

    const onProfileUpdated = () => {
      const cached = api.getCachedLeaderboard();
      if (cached) setEntries(cached.entries);
    };

    window.addEventListener('sync:sp-updated', onSpUpdated);
    window.addEventListener('sync:profile-updated', onProfileUpdated);
    return () => {
      unsubBoard();
      unsubMe();
      window.removeEventListener('sync:sp-updated', onSpUpdated);
      window.removeEventListener('sync:profile-updated', onProfileUpdated);
    };
  }, [loadLeaders, user?.id]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = getLeaderboardEpochInfo();
      setEpochInfo((prev) => {
        if (next.epoch !== prev.epoch) {
          loadLeaders(true);
        }
        return next;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [loadLeaders]);

  if (activeTab !== 'home') {
    return null;
  }

  const topLeaders = entries.slice(0, 5);
  const todayUtc = new Date().toISOString().slice(0, 10);
  const myResolved = myEntry || (user ? entries.find((e) => e.user_id === user.id) || null : null);
  const isDailyUnlocked = !!(myResolved && myResolved.daily_unlocked_day === todayUtc);
  const myRank = myResolved ? entries.findIndex((e) => e.user_id === myResolved.user_id) + 1 : 0;
  const clearTopAuthBar = !user;

  return (
    <aside
      aria-label="SP Leaderboard Sidebar"
      className={`hidden xl:flex flex-col fixed right-0 w-72 2xl:w-80 px-5 z-20 pointer-events-none select-none ${
        clearTopAuthBar ? 'top-16' : 'top-5'
      }`}
    >
      <div className="pointer-events-auto glass-card rounded-3xl p-4 border border-white/[0.08] flex flex-col gap-3 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              soundFX.playTap();
              onOpenLeaderboard();
            }}
            className="flex items-center gap-2 text-xs font-semibold text-white hover:text-zinc-200 transition cursor-pointer"
          >
            <LeaderboardIcon className="w-4 h-4 text-amber-300" />
            <span>SP Leaders</span>
          </button>
          <span
            className="inline-flex items-center gap-1 text-[10px] font-mono tabular-nums text-zinc-400 px-2 py-0.5 rounded-lg bg-white/[0.04] border border-white/[0.06]"
            title="Leaderboard updates every 30 minutes"
          >
            <Clock className="w-2.5 h-2.5 text-emerald-400" />
            <span>{formatMiniCountdown(epochInfo.msRemaining)}</span>
          </span>
        </div>

        {/* Ranked Top Creators */}
        {topLeaders.length === 0 ? (
          <div className="text-[11px] text-zinc-500 py-2 px-1 leading-relaxed">
            Post, comment, repost, or quote to claim #1 on the 30-minute SP board.
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {topLeaders.map((entry, idx) => {
              const isSelf = user?.id === entry.user_id;
              return (
                <button
                  key={entry.user_id}
                  type="button"
                  onClick={() => {
                    soundFX.playTap();
                    onOpenProfile(entry.username);
                  }}
                  className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded-2xl transition text-left cursor-pointer ${
                    isSelf
                      ? 'bg-white/[0.08] border border-white/15'
                      : 'hover:bg-white/[0.06] border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className={`text-[11px] font-mono font-bold tabular-nums w-4 text-center shrink-0 ${
                        idx === 0
                          ? 'text-amber-300'
                          : idx === 1
                          ? 'text-zinc-300'
                          : idx === 2
                          ? 'text-orange-300'
                          : 'text-zinc-500'
                      }`}
                    >
                      {idx + 1}
                    </span>
                    <Avatar
                      userId={entry.user_id}
                      name={entry.display_name}
                      url={entry.avatar_url}
                      size="xs"
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1 min-w-0">
                        <span className="text-xs font-medium text-zinc-100 truncate">
                          {entry.display_name}
                        </span>
                        {entry.is_verified && (
                          <Sparkles
                            className="w-3 h-3 text-sky-300 shrink-0"
                            aria-label="Ultra 2x SP"
                          />
                        )}
                      </div>
                      <div className="text-[10px] font-mono text-zinc-500 truncate">
                        @{entry.username}
                      </div>
                    </div>
                  </div>
                  <span className="text-[11px] font-mono font-semibold text-emerald-300 tabular-nums shrink-0 pl-1">
                    {entry.points.toLocaleString()}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Signed-in Daily SP Snapshot */}
        {user && (
          <div className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-2xl bg-white/[0.03] border border-white/[0.07] text-[11px]">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-zinc-400">Your SP:</span>
              <span className="font-mono font-bold text-white tabular-nums">
                {(myResolved?.points ?? 0).toLocaleString()}
              </span>
              {myRank > 0 && (
                <span className="font-mono text-zinc-500 tabular-nums">#{myRank}</span>
              )}
            </div>
            {isDailyUnlocked ? (
              <span className="inline-flex items-center gap-1 text-emerald-300 font-medium shrink-0">
                <CheckCircle2 className="w-3 h-3" />
                <span>Unlocked</span>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  soundFX.playTap();
                  onOpenCreatePost?.();
                }}
                className="inline-flex items-center gap-1 text-amber-300 hover:text-amber-200 font-medium cursor-pointer shrink-0 transition"
              >
                <Circle className="w-3 h-3" />
                <span>+50 Daily</span>
              </button>
            )}
          </div>
        )}

        {/* Mechanics Micro-note & Full Board CTA */}
        <div className="pt-2 border-t border-white/[0.07] flex flex-col gap-2">
          <p className="text-[10px] text-zinc-500 leading-snug px-0.5">
            Updates every 30m · <span className="text-sky-300/90 font-medium">Ultra</span> earns 2x SP
          </p>
          <button
            type="button"
            onClick={() => {
              soundFX.playTap();
              onOpenLeaderboard();
            }}
            className="w-full py-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-xs font-semibold text-zinc-200 hover:text-white border border-white/[0.08] transition cursor-pointer active:scale-[0.98]"
          >
            View Full Leaderboard
          </button>
        </div>
      </div>
    </aside>
  );
};
