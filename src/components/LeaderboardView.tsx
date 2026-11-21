import React, { useState, useEffect, useCallback } from 'react';
import {
  Sparkles,
  Zap,
  Flame,
  Clock,
  CheckCircle2,
  Circle,
  RefreshCw,
  MessageCircle,
  Repeat2,
  Quote,
  PenSquare,
} from 'lucide-react';
import { LeaderboardEntry } from '../types';
import { api, getLeaderboardEpochInfo } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Avatar } from './Avatar';
import { LeaderboardIcon } from './LeaderboardIcon';
import { soundFX } from '../lib/sounds';

interface LeaderboardViewProps {
  onOpenProfile: (username: string) => void;
  onOpenCreatePost?: () => void;
}

function formatCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export const LeaderboardView: React.FC<LeaderboardViewProps> = ({
  onOpenProfile,
  onOpenCreatePost,
}) => {
  const { user, openAuth } = useAuth();
  const [entries, setEntries] = useState<LeaderboardEntry[]>(
    () => api.getCachedLeaderboard()?.entries || []
  );
  const [myEntry, setMyEntry] = useState<LeaderboardEntry | null>(null);
  const [loading, setLoading] = useState<boolean>(() => !api.getCachedLeaderboard());
  const [refreshing, setRefreshing] = useState(false);
  const [epochInfo, setEpochInfo] = useState(() => getLeaderboardEpochInfo());

  const loadLeaderboard = useCallback(async (force = false) => {
    if (force) setRefreshing(true);
    try {
      const [boardRes, meRes] = await Promise.all([
        api.getLeaderboard(force),
        user ? api.getMySyncPoints() : Promise.resolve(null),
      ]);
      setEntries(boardRes.entries);
      if (meRes) setMyEntry(meRes);
    } catch {
      // Keep cached snapshot if offline
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadLeaderboard(false);
  }, [loadLeaderboard]);

  // Real-time < 1s Firestore live subscription for SP points & leaderboard standings
  useEffect(() => {
    const unsubBoard = api.subscribeLeaderboard((liveEntries) => {
      setEntries(liveEntries);
      setLoading(false);
    });
    const unsubMe = user?.id
      ? api.subscribeMySyncPoints(user.id, (entry) => {
          setMyEntry(entry);
        })
      : () => {};

    const onSpUpdated = (e: Event) => {
      const detail = (e as CustomEvent<LeaderboardEntry>).detail;
      if (!detail) return;
      setMyEntry(detail);
      setEntries((prev) => {
        const exists = prev.some((item) => item.user_id === detail.user_id);
        const updated = exists
          ? prev.map((item) => (item.user_id === detail.user_id ? detail : item))
          : [...prev, detail];
        return updated.sort((a, b) => b.points - a.points);
      });
    };
    window.addEventListener('sync:sp-updated', onSpUpdated);
    return () => {
      unsubBoard();
      unsubMe();
      window.removeEventListener('sync:sp-updated', onSpUpdated);
    };
  }, [user?.id]);

  // Live 1-second timer for 30-minute refresh countdown & automatic epoch rollover
  useEffect(() => {
    const timer = setInterval(() => {
      const next = getLeaderboardEpochInfo();
      setEpochInfo((prev) => {
        if (next.epoch !== prev.epoch) {
          loadLeaderboard(true);
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [loadLeaderboard]);

  const todayUtc = new Date().toISOString().slice(0, 10);
  const myResolved = myEntry || (user ? entries.find((e) => e.user_id === user.id) || null : null);
  const isDailyUnlocked = !!(myResolved && myResolved.daily_unlocked_day === todayUtc);
  const myRank = myResolved ? entries.findIndex((e) => e.user_id === myResolved.user_id) + 1 : 0;

  return (
    <div className="max-w-2xl mx-auto pb-16">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5 pb-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-white/10 border border-white/15 flex items-center justify-center text-white shadow-[0_0_20px_rgba(255,255,255,0.08)]">
            <LeaderboardIcon className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white tracking-wide flex items-center gap-2">
              <span>SP Leaderboard</span>
            </h2>
            <p className="text-xs text-zinc-400">
              Updates every 30 minutes across the SYNC network
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.05] border border-white/10 text-xs text-zinc-200 font-mono tabular-nums"
            title="Next automatic 30-minute leaderboard snapshot"
          >
            <Clock className="w-3.5 h-3.5 text-emerald-400" />
            <span>{formatCountdown(epochInfo.msRemaining)}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              soundFX.playTap();
              loadLeaderboard(true);
            }}
            disabled={refreshing}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/[0.05] hover:bg-white/10 border border-white/10 text-zinc-300 hover:text-white transition cursor-pointer active:scale-95 disabled:opacity-50"
            title="Refresh Leaderboard Snapshot"
            aria-label="Refresh Leaderboard"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Daily Sync Points & Hey-inspired Mechanics Banner */}
      <div className="glass-card rounded-3xl p-5 sm:p-6 border border-white/15 mb-6 relative overflow-hidden">
        <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-white/[0.04] blur-2xl pointer-events-none" />

        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-4">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-300 mb-1.5">
              <Zap className="w-3.5 h-3.5 fill-emerald-300" />
              <span>Daily Sync Points (SP)</span>
            </div>
            <h3 className="text-base font-bold text-white leading-snug">
              Unlock your Daily SP with just one interaction
            </h3>
            <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
              Your first post, comment, repost, or quote each day unlocks a <strong className="text-white">+50 SP</strong> daily bonus plus action SP (e.g. <strong className="text-emerald-300">+70 SP</strong> for your 1st post of the day, then <strong className="text-zinc-200">+20 SP</strong> per post after).
            </p>
          </div>

          {user && (
            <div className="shrink-0 flex sm:flex-col items-center sm:items-end justify-between gap-2 p-3 rounded-2xl bg-white/[0.04] border border-white/10">
              <div className="text-right">
                <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">Your SP</div>
                <div className="text-xl font-bold text-white font-mono tabular-nums">
                  {myResolved?.points ?? 0}
                </div>
              </div>
              <div className="flex items-center gap-2 text-[11px]">
                {myRank > 0 && (
                  <span className="font-mono font-semibold text-zinc-300 tabular-nums">#{myRank}</span>
                )}
                <span className="inline-flex items-center gap-1 text-amber-300 font-semibold tabular-nums">
                  <Flame className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                  <span>{myResolved?.streak_days ?? 0}d</span>
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Qualifying Interactions Breakdown */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
          {[
            { label: 'Post', sp: '+20 SP', icon: PenSquare },
            { label: 'Comment', sp: '+10 SP', icon: MessageCircle },
            { label: 'Repost', sp: '+15 SP', icon: Repeat2 },
            { label: 'Quote', sp: '+25 SP', icon: Quote },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.label}
                className="flex items-center justify-between gap-2 px-3 py-2 rounded-2xl bg-white/[0.03] border border-white/[0.08]"
              >
                <div className="flex items-center gap-1.5 text-xs text-zinc-200 font-medium">
                  <Icon className="w-3.5 h-3.5 text-zinc-400" />
                  <span>{item.label}</span>
                </div>
                <span className="text-[11px] font-mono font-semibold text-emerald-300 tabular-nums">
                  {item.sp}
                </span>
              </div>
            );
          })}
        </div>

        {/* Why It Matters + Daily Unlock Status Footer */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3.5 border-t border-white/[0.08] text-xs">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-zinc-300">
            <span className="inline-flex items-center gap-1.5">
              <LeaderboardIcon className="w-3.5 h-3.5 text-amber-300" />
              <span>Leaderboard updates every 30 min</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-sky-300" />
              <span>
                <strong className="text-white">Ultra</strong> members earn <strong className="text-sky-300">2x SP</strong>
              </span>
            </span>
          </div>

          {user ? (
            <button
              type="button"
              onClick={() => {
                if (!isDailyUnlocked && onOpenCreatePost) {
                  soundFX.playTap();
                  onOpenCreatePost();
                }
              }}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold shrink-0 transition ${
                isDailyUnlocked
                  ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 cursor-default'
                  : 'glass-button-primary cursor-pointer'
              }`}
            >
              {isDailyUnlocked ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Daily SP Unlocked</span>
                </>
              ) : (
                <>
                  <Circle className="w-3.5 h-3.5" />
                  <span>Post to Unlock +50 SP</span>
                </>
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => openAuth('login')}
              className="glass-button-primary px-4 py-1.5 text-xs font-semibold shrink-0 cursor-pointer"
            >
              Sign in to Earn SP
            </button>
          )}
        </div>
      </div>

      {/* Ranked Leaderboard Table */}
      <div className="flex items-center justify-between px-1 mb-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Top Creators by Sync Points
        </h3>
        <span className="text-[11px] font-mono text-zinc-500 tabular-nums">
          {entries.length} {entries.length === 1 ? 'member' : 'members'}
        </span>
      </div>

      {loading && entries.length === 0 ? (
        <div className="flex flex-col gap-2.5">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="p-4 rounded-2xl glass-surface border border-white/10 flex items-center justify-between animate-pulse"
            >
              <div className="flex items-center gap-3">
                <div className="w-6 h-4 rounded bg-white/10" />
                <div className="w-10 h-10 rounded-full bg-white/10" />
                <div className="space-y-1.5">
                  <div className="w-28 h-3 rounded bg-white/10" />
                  <div className="w-20 h-2.5 rounded bg-white/5" />
                </div>
              </div>
              <div className="w-14 h-5 rounded bg-white/10" />
            </div>
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="glass-card rounded-3xl p-10 text-center border border-white/10">
          <LeaderboardIcon className="w-9 h-9 text-zinc-500 mx-auto mb-3" />
          <h4 className="text-sm font-semibold text-white mb-1">Rankings Initializing</h4>
          <p className="text-xs text-zinc-500">
            Publish a post, story, or comment to claim the #1 spot on the next half-hour leaderboard cycle.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {entries.map((entry, idx) => {
            const rank = idx + 1;
            const isSelf = user?.id === entry.user_id;
            const unlockedToday = entry.daily_unlocked_day === todayUtc;
            const rankStyle =
              rank === 1
                ? 'bg-amber-400/15 border-amber-400/40 text-amber-300 shadow-[0_0_20px_rgba(251,191,36,0.08)]'
                : rank === 2
                ? 'bg-zinc-200/10 border-zinc-300/30 text-zinc-200'
                : rank === 3
                ? 'bg-orange-400/10 border-orange-400/30 text-orange-300'
                : 'bg-white/[0.04] border-white/10 text-zinc-400';

            return (
              <button
                key={entry.user_id}
                type="button"
                onClick={() => {
                  soundFX.playTap();
                  onOpenProfile(entry.username);
                }}
                className={`w-full text-left p-3.5 sm:p-4 rounded-2xl glass-surface flex items-center justify-between gap-3 cursor-pointer transition hover:bg-white/[0.08] active:scale-[0.99] border ${
                  isSelf
                    ? 'border-white/35 bg-white/[0.07]'
                    : 'border-white/[0.08] hover:border-white/20'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div
                    className={`w-8 h-8 rounded-xl border flex items-center justify-center text-xs font-mono font-bold tabular-nums shrink-0 ${rankStyle}`}
                  >
                    {rank}
                  </div>

                  <Avatar
                    userId={entry.user_id}
                    name={entry.display_name}
                    url={entry.avatar_url}
                    size="md"
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-sm font-semibold text-white truncate">
                        {entry.display_name}
                      </span>
                      {entry.is_verified && (
                        <span
                          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-sky-400/15 border border-sky-400/30 text-[10px] font-semibold text-sky-300 shrink-0"
                          title="Ultra Member (2x SP)"
                        >
                          <Sparkles className="w-2.5 h-2.5" />
                          <span>2x</span>
                        </span>
                      )}
                      {isSelf && (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-white/10 text-zinc-200 shrink-0">
                          You
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-zinc-500 font-mono truncate mt-0.5">
                      <span className="truncate">@{entry.username}</span>
                      {entry.streak_days > 0 && (
                        <>
                          <span>•</span>
                          <span className="text-amber-300/90 tabular-nums">
                            {entry.streak_days}d streak
                          </span>
                        </>
                      )}
                      {unlockedToday && (
                        <>
                          <span>•</span>
                          <span className="text-emerald-400">Active today</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="text-right shrink-0 pl-2">
                  <div className="text-sm sm:text-base font-bold text-white font-mono tabular-nums">
                    {entry.points.toLocaleString()}
                  </div>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                    SP
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
