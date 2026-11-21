import React from 'react';
import { Zap, ChevronRight } from 'lucide-react';
import { motion } from 'motion/react';
import { getSpLevelProgress, useMySyncPoints } from '../lib/spLevels';
import { useAuth } from '../context/AuthContext';
import { soundFX } from '../lib/sounds';

interface SpLevelProgressBarProps {
  variant?: 'sidebar' | 'profile';
  onOpenLeaderboard?: () => void;
  className?: string;
}

export const SpLevelProgressBar: React.FC<SpLevelProgressBarProps> = ({
  variant = 'profile',
  onOpenLeaderboard,
  className = '',
}) => {
  const { user } = useAuth();
  const { totalSp } = useMySyncPoints();

  if (!user) return null;

  const progress = getSpLevelProgress(totalSp);

  if (variant === 'sidebar') {
    return (
      <button
        type="button"
        onClick={() => {
          soundFX.playTap();
          onOpenLeaderboard?.();
        }}
        title={`Level ${progress.level} (${progress.title}) — ${progress.spRemaining.toLocaleString()} SP until Lv.${progress.nextLevel}`}
        className={`w-full text-left px-3 py-2.5 rounded-2xl bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.08] hover:border-white/15 transition group cursor-pointer active:scale-[0.98] ${className}`}
      >
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-400/25 text-[10px] font-mono font-bold text-emerald-300 shrink-0">
              <Zap className="w-2.5 h-2.5 fill-emerald-300" />
              Lv.{progress.level}
            </span>
            <span className="text-[11px] font-semibold text-zinc-200 truncate">
              {progress.title}
            </span>
          </div>
          <span className="text-[10px] font-mono tabular-nums text-zinc-400 group-hover:text-zinc-200 shrink-0">
            {progress.totalSp.toLocaleString()} / {progress.nextLevelMinSp.toLocaleString()}
          </span>
        </div>

        <div
          role="progressbar"
          aria-label={`SP progress toward Level ${progress.nextLevel}`}
          aria-valuenow={progress.totalSp}
          aria-valuemin={progress.currentLevelMinSp}
          aria-valuemax={progress.nextLevelMinSp}
          className="h-1.5 w-full rounded-full bg-white/[0.08] overflow-hidden"
        >
          <motion.div
            initial={false}
            animate={{ width: `${Math.max(4, progress.progressPercent)}%` }}
            transition={{ type: 'spring', stiffness: 260, damping: 28 }}
            className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-teal-300 to-white shadow-[0_0_10px_rgba(52,211,153,0.5)]"
          />
        </div>

        <div className="flex items-center justify-between gap-2 mt-1.5 text-[10px] text-zinc-500">
          <span className="truncate">
            {progress.spRemaining.toLocaleString()} SP to Lv.{progress.nextLevel} · {progress.nextTitle}
          </span>
          <span className="font-mono tabular-nums text-zinc-400 shrink-0">
            {Math.round(progress.progressPercent)}%
          </span>
        </div>
      </button>
    );
  }

  return (
    <div
      className={`glass-card rounded-2xl sm:rounded-3xl p-4 sm:p-5 border border-white/10 mb-5 relative overflow-hidden ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-emerald-500/15 border border-emerald-400/30 text-[11px] font-mono font-bold text-emerald-300 shrink-0 shadow-[0_0_12px_rgba(52,211,153,0.18)]">
            <Zap className="w-3 h-3 fill-emerald-300" />
            <span>LVL {progress.level}</span>
          </span>
          <div className="min-w-0">
            <div className="text-xs sm:text-sm font-semibold text-white truncate">
              {progress.title} Tier
            </div>
            <div className="text-[11px] text-zinc-400 truncate">
              {progress.spRemaining.toLocaleString()} SP to Lv.{progress.nextLevel} ({progress.nextTitle})
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <div className="text-right">
            <div className="text-xs sm:text-sm font-mono font-bold text-white tabular-nums">
              {progress.totalSp.toLocaleString()}
              <span className="text-zinc-500 font-normal">
                {' '}
                / {progress.nextLevelMinSp.toLocaleString()} SP
              </span>
            </div>
            <div className="text-[10px] font-mono text-emerald-300 tabular-nums">
              {Math.round(progress.progressPercent)}% complete
            </div>
          </div>
          {onOpenLeaderboard && (
            <button
              type="button"
              onClick={() => {
                soundFX.playTap();
                onOpenLeaderboard();
              }}
              className="w-8 h-8 rounded-xl bg-white/[0.05] hover:bg-white/[0.12] border border-white/10 flex items-center justify-center text-zinc-300 hover:text-white transition cursor-pointer active:scale-95"
              title="Open SP Leaderboard"
              aria-label="Open SP Leaderboard"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div
        role="progressbar"
        aria-label={`Progress toward Level ${progress.nextLevel} (${progress.nextTitle})`}
        aria-valuenow={progress.totalSp}
        aria-valuemin={progress.currentLevelMinSp}
        aria-valuemax={progress.nextLevelMinSp}
        className="h-2.5 w-full rounded-full bg-white/[0.07] border border-white/[0.08] p-[1px] overflow-hidden"
      >
        <motion.div
          initial={false}
          animate={{ width: `${Math.max(progress.totalSp > 0 ? 3 : 0, progress.progressPercent)}%` }}
          transition={{ type: 'spring', stiffness: 240, damping: 26 }}
          className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-teal-300 to-white shadow-[0_0_14px_rgba(52,211,153,0.55)]"
        />
      </div>

      <div className="flex items-center justify-between mt-1.5 text-[10px] font-mono text-zinc-500 tabular-nums">
        <span>Lv.{progress.level} ({progress.currentLevelMinSp.toLocaleString()} SP)</span>
        <span>Lv.{progress.nextLevel} ({progress.nextLevelMinSp.toLocaleString()} SP)</span>
      </div>
    </div>
  );
};
