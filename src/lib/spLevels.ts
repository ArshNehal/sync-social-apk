import { useEffect, useState } from 'react';
import { api } from './api';
import { LeaderboardEntry } from '../types';
import { useAuth } from '../context/AuthContext';

export interface SpLevelTier {
  level: number;
  title: string;
  minSp: number;
}

export const SP_LEVEL_TIERS: SpLevelTier[] = [
  { level: 1, title: 'Initiate', minSp: 0 },
  { level: 2, title: 'Signal', minSp: 100 },
  { level: 3, title: 'Resonance', minSp: 250 },
  { level: 4, title: 'Catalyst', minSp: 500 },
  { level: 5, title: 'Aether', minSp: 1000 },
  { level: 6, title: 'Vanguard', minSp: 2000 },
  { level: 7, title: 'Luminance', minSp: 3500 },
  { level: 8, title: 'Sovereign', minSp: 6000 },
  { level: 9, title: 'Apex', minSp: 10000 },
];

const EXTRA_TIER_STEP_SP = 5000;
const MY_SP_STORAGE_PREFIX = 'sync_my_sp_v1_';

export interface SpLevelProgress {
  level: number;
  title: string;
  nextLevel: number;
  nextTitle: string;
  totalSp: number;
  currentLevelMinSp: number;
  nextLevelMinSp: number;
  spIntoLevel: number;
  spRequiredForLevel: number;
  spRemaining: number;
  progressPercent: number;
}

export function getSpLevelProgress(rawTotalSp: number): SpLevelProgress {
  const totalSp = Math.max(0, Math.floor(Number.isFinite(rawTotalSp) ? rawTotalSp : 0));

  const topDefinedTier = SP_LEVEL_TIERS[SP_LEVEL_TIERS.length - 1];
  if (totalSp >= topDefinedTier.minSp) {
    const extraLevels = Math.floor((totalSp - topDefinedTier.minSp) / EXTRA_TIER_STEP_SP);
    const level = topDefinedTier.level + extraLevels;
    const currentLevelMinSp = topDefinedTier.minSp + extraLevels * EXTRA_TIER_STEP_SP;
    const nextLevelMinSp = currentLevelMinSp + EXTRA_TIER_STEP_SP;
    const spIntoLevel = totalSp - currentLevelMinSp;
    const spRemaining = Math.max(0, nextLevelMinSp - totalSp);
    const progressPercent = Math.min(
      100,
      Math.max(0, Math.round((spIntoLevel / EXTRA_TIER_STEP_SP) * 1000) / 10)
    );

    return {
      level,
      title: 'Apex',
      nextLevel: level + 1,
      nextTitle: 'Apex',
      totalSp,
      currentLevelMinSp,
      nextLevelMinSp,
      spIntoLevel,
      spRequiredForLevel: EXTRA_TIER_STEP_SP,
      spRemaining,
      progressPercent,
    };
  }

  let currentIdx = 0;
  for (let i = 0; i < SP_LEVEL_TIERS.length; i += 1) {
    if (totalSp >= SP_LEVEL_TIERS[i].minSp) {
      currentIdx = i;
    } else {
      break;
    }
  }

  const currentTier = SP_LEVEL_TIERS[currentIdx];
  const nextTier = SP_LEVEL_TIERS[currentIdx + 1];
  const spRequiredForLevel = Math.max(1, nextTier.minSp - currentTier.minSp);
  const spIntoLevel = Math.max(0, totalSp - currentTier.minSp);
  const spRemaining = Math.max(0, nextTier.minSp - totalSp);
  const progressPercent = Math.min(
    100,
    Math.max(0, Math.round((spIntoLevel / spRequiredForLevel) * 1000) / 10)
  );

  return {
    level: currentTier.level,
    title: currentTier.title,
    nextLevel: nextTier.level,
    nextTitle: nextTier.title,
    totalSp,
    currentLevelMinSp: currentTier.minSp,
    nextLevelMinSp: nextTier.minSp,
    spIntoLevel,
    spRequiredForLevel,
    spRemaining,
    progressPercent,
  };
}

function readCachedMySp(uid?: string | null): number {
  if (!uid || typeof window === 'undefined') return 0;
  try {
    const raw = localStorage.getItem(`${MY_SP_STORAGE_PREFIX}${uid}`);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LeaderboardEntry>;
      if (typeof parsed?.points === 'number' && Number.isFinite(parsed.points)) {
        return Math.max(0, parsed.points);
      }
    }
  } catch {}
  return 0;
}

export function useMySyncPoints(): { totalSp: number; streakDays: number; loading: boolean } {
  const { user, authConfirmedUid } = useAuth();
  const uid = user?.id || null;
  const [totalSp, setTotalSp] = useState<number>(() => readCachedMySp(uid));
  const [streakDays, setStreakDays] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(Boolean(uid));

  useEffect(() => {
    if (!uid) {
      setTotalSp(0);
      setStreakDays(0);
      setLoading(false);
      return;
    }

    setTotalSp(readCachedMySp(uid));

    let active = true;
    api
      .getMySyncPoints()
      .then((entry) => {
        if (!active || !entry) return;
        setTotalSp(entry.points);
        setStreakDays(entry.streak_days || 0);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });

    const unsubLive =
      authConfirmedUid && authConfirmedUid === uid
        ? api.subscribeMySyncPoints(uid, (entry) => {
            if (!active) return;
            setTotalSp(entry.points);
            setStreakDays(entry.streak_days || 0);
            setLoading(false);
          })
        : () => {};

    const onSpUpdated = (e: Event) => {
      const detail = (e as CustomEvent<LeaderboardEntry>).detail;
      if (detail && detail.user_id === uid) {
        setTotalSp(detail.points);
        setStreakDays(detail.streak_days || 0);
        setLoading(false);
      }
    };

    window.addEventListener('sync:sp-updated', onSpUpdated);
    return () => {
      active = false;
      unsubLive();
      window.removeEventListener('sync:sp-updated', onSpUpdated);
    };
  }, [uid, authConfirmedUid]);

  return { totalSp, streakDays, loading };
}
