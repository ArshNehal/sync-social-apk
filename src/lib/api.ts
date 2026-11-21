import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  writeBatch,
  increment,
  runTransaction,
  serverTimestamp,
  Timestamp,
  onSnapshot,
} from 'firebase/firestore';
import type { User as FirebaseUser } from 'firebase/auth';
import { auth, db, handleFirestoreError, OperationType } from './firebase';
import { generateSalt, hashPassword, verifyPassword } from './crypto';
import {
  User,
  Post,
  Comment,
  Conversation,
  Message,
  MessageReaction,
  NotificationItem,
  Story,
  StoryGroup,
  StoryViewer,
  StoryHighlight,
  StoryHighlightItem,
  Note,
  FollowRequest,
  LeaderboardEntry,
} from '../types';

function extractMentions(text: string): string[] {
  if (!text) return [];
  const matches = text.toLowerCase().match(/@([a-z0-9_.]{3,20})/g) || [];
  const cleaned = matches
    .map((m) => m.slice(1).replace(/\.+$/, ''))
    .filter((u) => /^[a-z0-9_.]{3,20}$/.test(u));
  return Array.from(new Set(cleaned)).slice(0, 10);
}

const storyCollectionMap = new Map<string, 'stories' | 'close_friends_stories'>();

function toIsoString(ts: any): string {
  if (!ts) return new Date().toISOString();
  if (typeof ts === 'string') return ts;
  if (typeof ts?.toDate === 'function') return ts.toDate().toISOString();
  if (typeof ts?.seconds === 'number') return new Date(ts.seconds * 1000).toISOString();
  if (ts instanceof Date) return ts.toISOString();
  return new Date().toISOString();
}

// ==================== HIGH-SPEED IN-MEMORY & SWR CACHES ====================
const CACHE_TTL_USER_MS = 90_000;
const CACHE_TTL_STORIES_MS = 30_000;
const CACHE_TTL_FEED_MS = 30_000;
const STORIES_STORAGE_KEY = 'sync_stories_cache_v1';
const FEED_STORAGE_PREFIX = 'sync_feed_cache_v1_';
const VIEWED_STORIES_PREFIX = 'sync_viewed_stories_v1_';
const ME_STORAGE_KEY = 'sync_me_cache_v1';
const PROFILE_STORAGE_PREFIX = 'sync_profile_cache_v1_';
const USER_POSTS_STORAGE_PREFIX = 'sync_user_posts_v1_';
const HAS_PWD_STORAGE_PREFIX = 'sync_has_pwd_v1_';
const LEADERBOARD_STORAGE_KEY = 'sync_leaderboard_cache_v1';
const MY_SP_STORAGE_PREFIX = 'sync_my_sp_v1_';
const HALF_HOUR_MS = 1_800_000;
const DAILY_BONUS_SP = 50;
const SP_VALUES: Record<'post' | 'comment' | 'repost' | 'quote' | 'story', number> = {
  post: 20,
  quote: 25,
  repost: 15,
  story: 15,
  comment: 10,
};

const userByIdCache = new Map<string, { data: User; ts: number }>();
const userByNameCache = new Map<string, { data: User; ts: number }>();
const verifiedPrivateInfoUids = new Set<string>();
const feedMemoryCache = new Map<string, { posts: Post[]; ts: number }>();
let storiesMemoryCache: { storyGroups: StoryGroup[]; ts: number } | null = null;
let leaderboardMemoryCache: { epoch: number; entries: LeaderboardEntry[]; ts: number } | null = null;
let notificationsMemoryCache: { uid: string; items: NotificationItem[]; ts: number } | null = null;
let bookmarksMemoryCache: { uid: string; posts: Post[]; ts: number } | null = null;
let conversationsMemoryCache: { uid: string; items: Conversation[]; ts: number } | null = null;
let suggestedUsersMemoryCache: { uid: string; users: User[]; ts: number } | null = null;
const profileMemoryCache = new Map<string, { uid: string; user: User; ts: number }>();
const userPostsMemoryCache = new Map<string, { uid: string; posts: Post[]; ts: number }>();
const userLikesMemoryCache = new Map<string, { uid: string; posts: Post[]; ts: number }>();
const PRESENCE_STALE_MS = 120_000;
const presenceMemoryCache = new Map<string, { online: boolean; lastSeenMs: number }>();
const presenceSubscribers = new Map<string, Set<(isOnline: boolean) => void>>();
const presenceFirestoreUnsubs = new Map<string, () => void>();
const presenceLastNotified = new Map<string, boolean>();
let presenceStaleTimer: ReturnType<typeof setInterval> | null = null;

// ==================== REAL-TIME USER ENGAGEMENT STORE ====================
let liveEngUid: string | null = null;
let liveEngUnsubs: Array<() => void> = [];
let liveLikedPostIds = new Set<string>();
let liveBookmarkedPostIds = new Set<string>();
let liveBlockedUserIds = new Set<string>();
let liveFollowingUserIds = new Set<string>();
let liveLikedCommentIds = new Set<string>();
let liveLikesReady = false;
let liveBookmarksReady = false;
let liveBlocksReady = false;
let liveFollowingReady = false;
let liveCommentLikesReady = false;
const engagementListeners = new Set<() => void>();

function notifyEngagementListeners() {
  engagementListeners.forEach((cb) => {
    try {
      cb();
    } catch {}
  });
}

function resetLiveEngagementStore() {
  liveEngUnsubs.forEach((u) => {
    try {
      u();
    } catch {}
  });
  liveEngUnsubs = [];
  liveEngUid = null;
  liveLikedPostIds = new Set();
  liveBookmarkedPostIds = new Set();
  liveBlockedUserIds = new Set();
  liveFollowingUserIds = new Set();
  liveLikedCommentIds = new Set();
  liveLikesReady = false;
  liveBookmarksReady = false;
  liveBlocksReady = false;
  liveFollowingReady = false;
  liveCommentLikesReady = false;
}

function ensureLiveEngagementStore(uid?: string | null) {
  const activeUid = uid && auth.currentUser?.uid === uid ? uid : auth.currentUser?.uid || null;
  if (!activeUid) {
    if (liveEngUid !== null) {
      resetLiveEngagementStore();
      notifyEngagementListeners();
    }
    return;
  }
  if (liveEngUid === activeUid && liveEngUnsubs.length > 0) return;

  resetLiveEngagementStore();
  liveEngUid = activeUid;

  const uLikes = onSnapshot(
    query(collection(db, 'likes'), where('user_id', '==', activeUid)),
    (snap) => {
      const next = new Set<string>();
      snap.docs.forEach((d) => {
        const pid = d.data().post_id;
        if (pid) next.add(pid);
      });
      liveLikedPostIds = next;
      liveLikesReady = true;
      notifyEngagementListeners();
    },
    () => {}
  );

  const uBookmarks = onSnapshot(
    query(collection(db, 'bookmarks'), where('user_id', '==', activeUid)),
    (snap) => {
      const next = new Set<string>();
      snap.docs.forEach((d) => {
        const pid = d.data().post_id;
        if (pid) next.add(pid);
      });
      liveBookmarkedPostIds = next;
      liveBookmarksReady = true;
      notifyEngagementListeners();
    },
    () => {}
  );

  const uBlocks = onSnapshot(
    query(collection(db, 'blocks'), where('blocker_id', '==', activeUid)),
    (snap) => {
      const next = new Set<string>();
      snap.docs.forEach((d) => {
        const bid = d.data().blocked_id;
        if (bid) next.add(bid);
      });
      liveBlockedUserIds = next;
      liveBlocksReady = true;
      notifyEngagementListeners();
    },
    () => {}
  );

  const uFollows = onSnapshot(
    query(collection(db, 'follows'), where('follower_id', '==', activeUid)),
    (snap) => {
      const next = new Set<string>();
      snap.docs.forEach((d) => {
        const fid = d.data().following_id;
        if (fid) next.add(fid);
      });
      liveFollowingUserIds = next;
      liveFollowingReady = true;
      notifyEngagementListeners();
    },
    () => {}
  );

  const uCommentLikes = onSnapshot(
    query(collection(db, 'comment_likes'), where('user_id', '==', activeUid)),
    (snap) => {
      const next = new Set<string>();
      snap.docs.forEach((d) => {
        const cid = d.data().comment_id;
        if (cid) next.add(cid);
      });
      liveLikedCommentIds = next;
      liveCommentLikesReady = true;
      notifyEngagementListeners();
    },
    () => {}
  );

  liveEngUnsubs = [uLikes, uBookmarks, uBlocks, uFollows, uCommentLikes];
}

function subscribeToEngagementListeners(cb: () => void): () => void {
  engagementListeners.add(cb);
  return () => {
    engagementListeners.delete(cb);
  };
}

function mapRawDocsToPosts(
  rawDocs: any[],
  likedSet: Set<string>,
  bookmarkedSet: Set<string>
): Post[] {
  return rawDocs.map((d) => ({
    id: d.id,
    user_id: d.user_id,
    username: d.username,
    display_name: d.display_name,
    avatar_url: d.avatar_url || '',
    is_verified: !!d.is_verified,
    content: d.content || '',
    images: Array.isArray(d.images) ? d.images : [],
    likes_count: typeof d.likes_count === 'number' ? d.likes_count : 0,
    comments_count: typeof d.comments_count === 'number' ? d.comments_count : 0,
    reposts_count: typeof d.reposts_count === 'number' ? d.reposts_count : 0,
    is_repost: !!d.is_repost,
    repost_of_id: d.repost_of_id || null,
    repost_of_user: d.repost_of_user || null,
    repost_of_display_name: d.repost_of_display_name || null,
    repost_of_content: d.repost_of_content || null,
    repost_of_image: d.repost_of_image || null,
    is_pinned: !!d.is_pinned,
    pinned_at: d.pinned_at ? toIsoString(d.pinned_at) : null,
    hide_likes: !!d.hide_likes,
    comments_disabled: !!d.comments_disabled,
    mentions: Array.isArray(d.mentions) ? d.mentions : [],
    created_at: toIsoString(d.created_at),
    updated_at: toIsoString(d.updated_at),
    is_liked: likedSet.has(d.id),
    is_bookmarked: bookmarkedSet.has(d.id),
  }));
}

function isPresenceActive(entry?: { online: boolean; lastSeenMs: number }): boolean {
  if (!entry || !entry.online) return false;
  return Date.now() - entry.lastSeenMs < PRESENCE_STALE_MS;
}

function notifyPresenceSubscribers(uid: string) {
  const active = isPresenceActive(presenceMemoryCache.get(uid));
  const prev = presenceLastNotified.get(uid);
  presenceLastNotified.set(uid, active);
  if (prev === active) return;
  const subs = presenceSubscribers.get(uid);
  if (!subs) return;
  subs.forEach((cb) => {
    try {
      cb(active);
    } catch {}
  });
}

function ensurePresenceStaleSweep() {
  if (presenceStaleTimer !== null) return;
  presenceStaleTimer = setInterval(() => {
    presenceSubscribers.forEach((_subs, uid) => {
      const entry = presenceMemoryCache.get(uid);
      if (entry?.online && !isPresenceActive(entry)) {
        notifyPresenceSubscribers(uid);
      }
    });
  }, 20_000);
}

function stopPresenceStaleSweepIfIdle() {
  if (presenceSubscribers.size === 0 && presenceStaleTimer !== null) {
    clearInterval(presenceStaleTimer);
    presenceStaleTimer = null;
  }
}

function toPublicCachedUser(u: User): User {
  return {
    id: u.id,
    username: u.username,
    display_name: u.display_name,
    bio: u.bio || '',
    avatar_url: u.avatar_url || '',
    banner_url: u.banner_url || '',
    website: u.website || '',
    location: u.location || '',
    is_verified: !!u.is_verified,
    is_private: !!u.is_private,
    created_at: u.created_at,
    posts_count: u.posts_count,
    followers_count: u.followers_count,
    following_count: u.following_count,
  };
}

export function getCachedMe(): User | null {
  try {
    const raw = localStorage.getItem(ME_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as User;
    if (parsed && parsed.id && parsed.username) {
      return parsed;
    }
  } catch {}
  return null;
}

export function saveCachedMe(u: User | null | undefined) {
  if (!u || !u.id || !u.username) return;
  try {
    localStorage.setItem(ME_STORAGE_KEY, JSON.stringify(toPublicCachedUser(u)));
  } catch {}
}

export function clearCachedMe() {
  try {
    localStorage.removeItem(ME_STORAGE_KEY);
  } catch {}
}

export function clearAccountSwitchCaches() {
  clearCachedMe();
  userByIdCache.clear();
  userByNameCache.clear();
  verifiedPrivateInfoUids.clear();
  feedMemoryCache.clear();
  storiesMemoryCache = null;
  notificationsMemoryCache = null;
  bookmarksMemoryCache = null;
  conversationsMemoryCache = null;
  suggestedUsersMemoryCache = null;
  profileMemoryCache.clear();
  userPostsMemoryCache.clear();
  userLikesMemoryCache.clear();
  resetLiveEngagementStore();
  notifyEngagementListeners();
  try {
    localStorage.removeItem(STORIES_STORAGE_KEY);
    localStorage.removeItem(`${FEED_STORAGE_PREFIX}for_you__`);
    localStorage.removeItem(`${FEED_STORAGE_PREFIX}latest__`);
  } catch {}
}

export function getCachedHasPassword(uid?: string): boolean {
  if (!uid) return false;
  try {
    return localStorage.getItem(`${HAS_PWD_STORAGE_PREFIX}${uid}`) === '1';
  } catch {
    return false;
  }
}

export function saveCachedHasPassword(uid: string, hasPwd: boolean) {
  if (!uid) return;
  try {
    localStorage.setItem(`${HAS_PWD_STORAGE_PREFIX}${uid}`, hasPwd ? '1' : '0');
  } catch {}
}

function saveStoredProfile(usernameLower: string, user: User) {
  try {
    localStorage.setItem(`${PROFILE_STORAGE_PREFIX}${usernameLower}`, JSON.stringify(toPublicCachedUser(user)));
  } catch {}
}

function loadStoredProfile(usernameLower: string): User | null {
  try {
    const raw = localStorage.getItem(`${PROFILE_STORAGE_PREFIX}${usernameLower}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as User;
    if (parsed && parsed.id && parsed.username) return parsed;
  } catch {}
  return null;
}

function saveStoredUserPosts(usernameLower: string, posts: Post[]) {
  try {
    localStorage.setItem(`${USER_POSTS_STORAGE_PREFIX}${usernameLower}`, JSON.stringify(posts.slice(0, 12)));
  } catch {}
}

function loadStoredUserPosts(usernameLower: string): Post[] | null {
  try {
    const raw = localStorage.getItem(`${USER_POSTS_STORAGE_PREFIX}${usernameLower}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {}
  return null;
}

function cacheUser(u: User | null | undefined): User | null {
  if (!u || !u.id) return null;
  const now = Date.now();
  userByIdCache.set(u.id, { data: u, ts: now });
  if (u.username) {
    userByNameCache.set(u.username.toLowerCase(), { data: u, ts: now });
  }
  return u;
}

// Synchronously seed user caches on boot so 0ms profile lookups succeed immediately
(() => {
  const bootMe = getCachedMe();
  if (bootMe) {
    cacheUser(bootMe);
  }
})();

function invalidateUserCache(uid?: string, username?: string) {
  if (uid) userByIdCache.delete(uid);
  if (username) {
    const clean = username.toLowerCase();
    userByNameCache.delete(clean);
    profileMemoryCache.delete(clean);
    try {
      localStorage.removeItem(`${PROFILE_STORAGE_PREFIX}${clean}`);
    } catch {}
  }
}

function invalidateFeedCache() {
  feedMemoryCache.clear();
  userPostsMemoryCache.clear();
}

function invalidateStoriesCache() {
  storiesMemoryCache = null;
  try {
    localStorage.removeItem(STORIES_STORAGE_KEY);
  } catch {}
}

function getTodayUtcDay(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export function getLeaderboardEpochInfo(): {
  epoch: number;
  lastRefreshMs: number;
  nextRefreshMs: number;
  msRemaining: number;
} {
  const now = Date.now();
  const epoch = Math.floor(now / HALF_HOUR_MS);
  const lastRefreshMs = epoch * HALF_HOUR_MS;
  const nextRefreshMs = (epoch + 1) * HALF_HOUR_MS;
  return {
    epoch,
    lastRefreshMs,
    nextRefreshMs,
    msRemaining: Math.max(0, nextRefreshMs - now),
  };
}

function patchPostAuthorInArray(posts: Post[], uid: string, nextUser: User): Post[] {
  let changed = false;
  const mapped = posts.map((p) => {
    if (p.user_id !== uid) return p;
    changed = true;
    return {
      ...p,
      username: nextUser.username,
      display_name: nextUser.display_name,
      avatar_url: nextUser.avatar_url || '',
    };
  });
  return changed ? mapped : posts;
}

function patchAllCachesForUser(updatedUser: User, oldUsername?: string) {
  const uid = updatedUser.id;
  // 1. Feed memory cache
  feedMemoryCache.forEach((entry, key) => {
    const patched = patchPostAuthorInArray(entry.posts, uid, updatedUser);
    if (patched !== entry.posts) {
      feedMemoryCache.set(key, { ...entry, posts: patched });
    }
  });
  // 2. Feed localStorage caches
  for (const key of ['for_you__', 'latest__']) {
    try {
      const raw = localStorage.getItem(`${FEED_STORAGE_PREFIX}${key}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed?.posts)) {
          const patched = patchPostAuthorInArray(parsed.posts, uid, updatedUser);
          if (patched !== parsed.posts) {
            localStorage.setItem(`${FEED_STORAGE_PREFIX}${key}`, JSON.stringify({ ...parsed, posts: patched }));
          }
        }
      }
    } catch {}
  }
  // 3. User posts memory + localStorage caches
  const oldClean = oldUsername?.trim().toLowerCase();
  const newClean = updatedUser.username.trim().toLowerCase();
  if (oldClean && oldClean !== newClean) {
    const oldPosts = userPostsMemoryCache.get(oldClean);
    if (oldPosts) {
      userPostsMemoryCache.delete(oldClean);
      userPostsMemoryCache.set(newClean, {
        ...oldPosts,
        posts: patchPostAuthorInArray(oldPosts.posts, uid, updatedUser),
      });
    }
    try {
      localStorage.removeItem(`${USER_POSTS_STORAGE_PREFIX}${oldClean}`);
    } catch {}
  }
  const newPostsEntry = userPostsMemoryCache.get(newClean);
  if (newPostsEntry) {
    const patched = patchPostAuthorInArray(newPostsEntry.posts, uid, updatedUser);
    userPostsMemoryCache.set(newClean, { ...newPostsEntry, posts: patched });
    saveStoredUserPosts(newClean, patched);
  }
  // 4. Bookmarks & likes memory caches
  if (bookmarksMemoryCache) {
    bookmarksMemoryCache = {
      ...bookmarksMemoryCache,
      posts: patchPostAuthorInArray(bookmarksMemoryCache.posts, uid, updatedUser),
    };
  }
  userLikesMemoryCache.forEach((entry, key) => {
    userLikesMemoryCache.set(key, {
      ...entry,
      posts: patchPostAuthorInArray(entry.posts, uid, updatedUser),
    });
  });
  // 5. Stories memory + localStorage caches
  if (storiesMemoryCache) {
    const nextGroups = storiesMemoryCache.storyGroups.map((g) =>
      g.userId === uid
        ? {
            ...g,
            username: updatedUser.username,
            displayName: updatedUser.display_name,
            avatarUrl: updatedUser.avatar_url || '',
          }
        : g
    );
    saveStoriesCache(nextGroups);
  } else {
    try {
      const raw = localStorage.getItem(STORIES_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed?.storyGroups)) {
          const nextGroups = parsed.storyGroups.map((g: StoryGroup) =>
            g.userId === uid
              ? {
                  ...g,
                  username: updatedUser.username,
                  displayName: updatedUser.display_name,
                  avatarUrl: updatedUser.avatar_url || '',
                }
              : g
          );
          localStorage.setItem(STORIES_STORAGE_KEY, JSON.stringify({ ...parsed, storyGroups: nextGroups }));
        }
      }
    } catch {}
  }
  // 6. Leaderboard cache
  if (leaderboardMemoryCache) {
    leaderboardMemoryCache = {
      ...leaderboardMemoryCache,
      entries: leaderboardMemoryCache.entries.map((entry) =>
        entry.user_id === uid
          ? {
              ...entry,
              username: updatedUser.username,
              display_name: updatedUser.display_name,
              avatar_url: updatedUser.avatar_url || '',
            }
          : entry
      ),
    };
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('sync:profile-updated', { detail: updatedUser }));
  }
}

function prependPostToCaches(post: Post) {
  for (const key of ['for_you__', 'latest__', 'following__']) {
    const existing = feedMemoryCache.get(key);
    if (existing) {
      const deduped = [post, ...existing.posts.filter((p) => p.id !== post.id)].slice(0, 50);
      saveFeedCache(key, deduped);
    }
  }
  const cleanUser = post.username.toLowerCase();
  const existingUserPosts = userPostsMemoryCache.get(cleanUser);
  if (existingUserPosts) {
    const next = [post, ...existingUserPosts.posts.filter((p) => p.id !== post.id)];
    userPostsMemoryCache.set(cleanUser, { ...existingUserPosts, posts: next, ts: Date.now() });
    saveStoredUserPosts(cleanUser, next);
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('sync:post-created', { detail: post }));
  }
}

function patchPostEngagementInCaches(postId: string, patch: Partial<Post>) {
  feedMemoryCache.forEach((entry, key) => {
    let changed = false;
    const next = entry.posts.map((p) => {
      if (p.id !== postId) return p;
      changed = true;
      return { ...p, ...patch };
    });
    if (changed) feedMemoryCache.set(key, { ...entry, posts: next });
  });
  userPostsMemoryCache.forEach((entry, key) => {
    let changed = false;
    const next = entry.posts.map((p) => {
      if (p.id !== postId) return p;
      changed = true;
      return { ...p, ...patch };
    });
    if (changed) userPostsMemoryCache.set(key, { ...entry, posts: next });
  });
  userLikesMemoryCache.forEach((entry, key) => {
    let changed = false;
    const next = entry.posts.map((p) => {
      if (p.id !== postId) return p;
      changed = true;
      return { ...p, ...patch };
    });
    if (changed) userLikesMemoryCache.set(key, { ...entry, posts: next });
  });
  if (bookmarksMemoryCache) {
    let changed = false;
    const next = bookmarksMemoryCache.posts.map((p) => {
      if (p.id !== postId) return p;
      changed = true;
      return { ...p, ...patch };
    });
    if (changed) bookmarksMemoryCache = { ...bookmarksMemoryCache, posts: next };
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('sync:post-updated', { detail: { postId, patch } }));
  }
}

function removePostFromCaches(postId: string) {
  feedMemoryCache.forEach((entry, key) => {
    feedMemoryCache.set(key, { ...entry, posts: entry.posts.filter((p) => p.id !== postId) });
  });
  userPostsMemoryCache.forEach((entry, key) => {
    userPostsMemoryCache.set(key, { ...entry, posts: entry.posts.filter((p) => p.id !== postId) });
  });
  userLikesMemoryCache.forEach((entry, key) => {
    userLikesMemoryCache.set(key, { ...entry, posts: entry.posts.filter((p) => p.id !== postId) });
  });
  if (bookmarksMemoryCache) {
    bookmarksMemoryCache = {
      ...bookmarksMemoryCache,
      posts: bookmarksMemoryCache.posts.filter((p) => p.id !== postId),
    };
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('sync:post-deleted', { detail: postId }));
  }
}

function getViewedStoriesMap(uid?: string): Record<string, number> {
  if (!uid) return {};
  try {
    const raw = localStorage.getItem(`${VIEWED_STORIES_PREFIX}${uid}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number>;
    const now = Date.now();
    const cleaned: Record<string, number> = {};
    for (const [k, exp] of Object.entries(parsed)) {
      if (typeof exp === 'number' && exp > now) cleaned[k] = exp;
    }
    return cleaned;
  } catch {
    return {};
  }
}

function markStoryViewedLocally(uid: string, storyId: string, expiresAtIso?: string) {
  try {
    const map = getViewedStoriesMap(uid);
    const expMs = expiresAtIso ? new Date(expiresAtIso).getTime() : Date.now() + 24 * 60 * 60 * 1000;
    map[storyId] = Number.isFinite(expMs) ? expMs : Date.now() + 24 * 60 * 60 * 1000;
    localStorage.setItem(`${VIEWED_STORIES_PREFIX}${uid}`, JSON.stringify(map));
  } catch {}
}

function filterActiveStoryGroups(groups: StoryGroup[], currentUid?: string): StoryGroup[] {
  const now = Date.now();
  const viewedMap = getViewedStoriesMap(currentUid);
  const out: StoryGroup[] = [];
  for (const g of groups) {
    const active = (g.stories || []).filter((s) => {
      const exp = new Date(s.expiresAt).getTime();
      return Number.isFinite(exp) && exp > now;
    });
    if (active.length === 0) continue;
    let hasUnviewed = false;
    const mapped = active.map((s) => {
      const isViewed = !!(s.isViewed || viewedMap[s.id]);
      if (!isViewed) hasUnviewed = true;
      return { ...s, isViewed };
    });
    out.push({
      ...g,
      hasUnviewed,
      stories: mapped,
    });
  }
  return out;
}

function saveStoriesCache(groups: StoryGroup[]) {
  storiesMemoryCache = { storyGroups: groups, ts: Date.now() };
  try {
    localStorage.setItem(STORIES_STORAGE_KEY, JSON.stringify({ storyGroups: groups, ts: Date.now() }));
  } catch {
    // Ignore quota errors if story images are large
  }
}

function loadStoriesCache(currentUid?: string): StoryGroup[] | null {
  if (storiesMemoryCache && storiesMemoryCache.storyGroups.length > 0) {
    return filterActiveStoryGroups(storiesMemoryCache.storyGroups, currentUid);
  }
  try {
    const raw = localStorage.getItem(STORIES_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.storyGroups) && parsed.storyGroups.length > 0) {
      const active = filterActiveStoryGroups(parsed.storyGroups, currentUid);
      if (active.length > 0) {
        storiesMemoryCache = { storyGroups: active, ts: parsed.ts || Date.now() };
        return active;
      }
    }
  } catch {}
  return null;
}

function getFeedKey(params?: { feed?: string; tag?: string }): string {
  const feed = params?.feed || 'for_you';
  const tag = (params?.tag || '').replace('#', '').toLowerCase();
  return `${feed}__${tag}`;
}

function saveFeedCache(key: string, posts: Post[]) {
  feedMemoryCache.set(key, { posts, ts: Date.now() });
  if (key === 'for_you__' || key === 'latest__') {
    try {
      localStorage.setItem(`${FEED_STORAGE_PREFIX}${key}`, JSON.stringify({ posts: posts.slice(0, 15), ts: Date.now() }));
    } catch {}
  }
}

function loadFeedCache(key: string): Post[] | null {
  const mem = feedMemoryCache.get(key);
  if (mem && Date.now() - mem.ts < CACHE_TTL_FEED_MS * 4) {
    return mem.posts;
  }
  if (key === 'for_you__' || key === 'latest__') {
    try {
      const raw = localStorage.getItem(`${FEED_STORAGE_PREFIX}${key}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.posts) && parsed.posts.length > 0) {
        return parsed.posts;
      }
    } catch {}
  }
  return null;
}

function genId(prefix: string): string {
  const raw =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 10)
      : Math.random().toString(36).slice(2, 12);
  return `${prefix}_${raw}`;
}

function sanitizeUsername(raw: string): string {
  let clean = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.]/g, '');
  if (clean.length < 3) {
    clean = (clean + 'user').slice(0, 12);
  }
  return clean.slice(0, 20);
}

async function compressDataUrl(dataUrl: string, maxDim = 1080, maxChars = 300000): Promise<string> {
  if (!dataUrl.startsWith('data:image/')) return dataUrl;
  if (dataUrl.length <= maxChars) return dataUrl;

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let width = img.width;
      let height = img.height;
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl.slice(0, maxChars));
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);
      let quality = 0.78;
      let out = canvas.toDataURL('image/jpeg', quality);
      while (out.length > maxChars && quality > 0.35) {
        quality -= 0.1;
        out = canvas.toDataURL('image/jpeg', quality);
      }

      // If still slightly large, scale down dimensions once more
      if (out.length > maxChars) {
        const smallCanvas = document.createElement('canvas');
        smallCanvas.width = Math.max(320, Math.round(width * 0.65));
        smallCanvas.height = Math.max(320, Math.round(height * 0.65));
        const sCtx = smallCanvas.getContext('2d');
        if (sCtx) {
          sCtx.drawImage(img, 0, 0, smallCanvas.width, smallCanvas.height);
          out = smallCanvas.toDataURL('image/jpeg', 0.65);
        }
      }
      resolve(out);
    };
    img.onerror = () => reject(new Error('Could not process selected image'));
    img.src = dataUrl;
  });
}

function requireUid(): string {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Please sign in to continue.');
  return uid;
}

async function getAuthenticatedUid(): Promise<string> {
  if (auth.currentUser?.uid) return auth.currentUser.uid;
  if (typeof (auth as any).authStateReady === 'function') {
    await (auth as any).authStateReady();
  }
  return requireUid();
}

async function getUserDocById(uid: string): Promise<User | null> {
  const cached = userByIdCache.get(uid);
  if (cached && Date.now() - cached.ts < CACHE_TTL_USER_MS) {
    return cached.data;
  }
  const path = `users/${uid}`;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) return null;
    const d = snap.data();
    return cacheUser({
      id: d.id || snap.id,
      username: d.username,
      display_name: d.display_name,
      bio: d.bio || '',
      avatar_url: d.avatar_url || '',
      banner_url: d.banner_url || '',
      website: d.website || '',
      location: d.location || '',
      is_verified: !!d.is_verified,
      is_private: !!d.is_private,
      created_at: toIsoString(d.created_at),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }
}

async function getFastActorDoc(uid: string): Promise<User | null> {
  const mem = userByIdCache.get(uid);
  if (mem?.data) return mem.data;
  const cachedMe = getCachedMe();
  if (cachedMe && cachedMe.id === uid) {
    cacheUser(cachedMe);
    return cachedMe;
  }
  return getUserDocById(uid);
}

async function getUserDocByUsername(username: string): Promise<User | null> {
  const clean = username.trim().toLowerCase();
  const cached = userByNameCache.get(clean);
  if (cached && Date.now() - cached.ts < CACHE_TTL_USER_MS) {
    return cached.data;
  }
  const path = 'users';
  try {
    const q = query(collection(db, 'users'), where('username_lower', '==', clean), limit(1));
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const d = snap.docs[0].data();
    return cacheUser({
      id: d.id || snap.docs[0].id,
      username: d.username,
      display_name: d.display_name,
      bio: d.bio || '',
      avatar_url: d.avatar_url || '',
      banner_url: d.banner_url || '',
      website: d.website || '',
      location: d.location || '',
      is_verified: !!d.is_verified,
      is_private: !!d.is_private,
      created_at: toIsoString(d.created_at),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

async function generateUniqueUsername(baseRaw: string, currentUid?: string): Promise<string> {
  const base = sanitizeUsername(baseRaw);
  let candidate = base;
  for (let i = 0; i < 8; i++) {
    const q = query(collection(db, 'users'), where('username_lower', '==', candidate), limit(1));
    const snap = await getDocs(q);
    if (snap.empty || snap.docs[0].id === currentUid) {
      return candidate;
    }
    const suffix = Math.floor(10 + Math.random() * 899).toString();
    candidate = sanitizeUsername((base.slice(0, 20 - suffix.length) + suffix).slice(0, 20));
  }
  return sanitizeUsername(`user_${(currentUid || genId('u')).slice(0, 8)}`);
}

const inFlightProfileSync = new Map<string, Promise<{ user: User; isNewUser: boolean }>>();

export async function ensureUserProfileWithMeta(
  fbUser: FirebaseUser
): Promise<{ user: User; isNewUser: boolean }> {
  const existingPromise = inFlightProfileSync.get(fbUser.uid);
  if (existingPromise) {
    return existingPromise;
  }

  const syncPromise = (async (): Promise<{ user: User; isNewUser: boolean }> => {
    const uid = fbUser.uid;
    const userPath = `users/${uid}`;
    const privatePath = `users/${uid}/private/info`;

    // Read cache/IndexedDB profile immediately without waiting for getIdToken network refresh
    let existingUser: User | null = await getUserDocById(uid).catch(() => null);
    if (!existingUser) {
      try {
        await fbUser.getIdToken();
      } catch {}
      try {
        const serverSnap = await getDocFromServer(doc(db, 'users', uid));
        if (serverSnap.exists()) {
          const d = serverSnap.data();
          existingUser = cacheUser({
            id: d.id || serverSnap.id,
            username: d.username,
            display_name: d.display_name,
            bio: d.bio || '',
            avatar_url: d.avatar_url || '',
            banner_url: d.banner_url || '',
            website: d.website || '',
            location: d.location || '',
            is_verified: !!d.is_verified,
            is_private: !!d.is_private,
            created_at: toIsoString(d.created_at),
          });
        }
      } catch {
        existingUser = null;
      }
    }

    const email = fbUser.email || `${uid}@users.sync`;

    if (!existingUser) {
      const baseName = fbUser.email?.split('@')[0] || fbUser.displayName || `member_${uid.slice(0, 6)}`;
      const username = await generateUniqueUsername(baseName, uid);
      const displayName = (fbUser.displayName || username).trim().slice(0, 80) || 'Member';
      const avatarUrl = (fbUser.photoURL || '').slice(0, 350000);

      try {
        await setDoc(doc(db, 'users', uid), {
          id: uid,
          username,
          username_lower: username,
          display_name: displayName,
          bio: 'Member of SYNC.',
          avatar_url: avatarUrl,
          banner_url: '',
          website: '',
          location: '',
          is_verified: false,
          is_private: false,
          created_at: serverTimestamp(),
          updated_at: serverTimestamp(),
        });
      } catch (err) {
        // If another tab or listener created the profile milliseconds earlier, read and return it
        const racedUser = await getUserDocById(uid).catch(() => null);
        if (racedUser) {
          existingUser = racedUser;
        } else {
          handleFirestoreError(err, OperationType.CREATE, userPath);
        }
      }

      if (!existingUser) {
        // Ensure private PII record exists
        try {
          await setDoc(doc(db, 'users', uid, 'private', 'info'), {
            uid,
            email: email.slice(0, 200),
            created_at: serverTimestamp(),
            updated_at: serverTimestamp(),
          });
        } catch (privErr) {
          console.warn('Could not initialize private user info:', privErr);
        }

        // Best-effort welcome notification
        try {
          const notifId = genId('notif');
          await setDoc(doc(db, 'notifications', notifId), {
            id: notifId,
            user_id: uid,
            actor_id: uid,
            actor_username: username,
            actor_display_name: displayName,
            actor_avatar_url: avatarUrl,
            actor_verified: false,
            type: 'welcome',
            target_id: 'welcome_sync',
            read: false,
            created_at: serverTimestamp(),
          });
        } catch (notifErr) {
          console.warn('Welcome notification skipped:', notifErr);
        }

        return {
          user: {
            id: uid,
            username,
            email,
            display_name: displayName,
            bio: 'Member of SYNC.',
            avatar_url: avatarUrl,
            banner_url: '',
            website: '',
            location: '',
            is_verified: false,
            is_private: false,
            created_at: new Date().toISOString(),
          },
          isNewUser: true,
        };
      }
    }

    // Ensure private PII doc exists for existing user (only check once per session)
    if (!verifiedPrivateInfoUids.has(uid)) {
      verifiedPrivateInfoUids.add(uid);
      getDoc(doc(db, 'users', uid, 'private', 'info'))
        .then((privSnap) => {
          if (!privSnap.exists()) {
            return setDoc(doc(db, 'users', uid, 'private', 'info'), {
              uid,
              email: email.slice(0, 200),
              created_at: serverTimestamp(),
              updated_at: serverTimestamp(),
            });
          }
        })
        .catch((err) => {
          verifiedPrivateInfoUids.delete(uid);
          console.warn('Private PII info check warning:', privatePath, err);
        });
    }

    const cachedProfile = cacheUser({ ...existingUser, email })!;
    return { user: cachedProfile, isNewUser: false };
  })();

  inFlightProfileSync.set(fbUser.uid, syncPromise);
  try {
    return await syncPromise;
  } finally {
    inFlightProfileSync.delete(fbUser.uid);
  }
}

export async function ensureUserProfile(fbUser: FirebaseUser): Promise<User> {
  const res = await ensureUserProfileWithMeta(fbUser);
  return res.user;
}

async function createNotificationDoc(params: {
  recipientId: string;
  actor: User;
  type: NotificationItem['type'];
  targetId: string;
}) {
  if (!params.recipientId || params.recipientId === params.actor.id) return;
  const notifId = genId('notif');
  const path = `notifications/${notifId}`;
  try {
    await setDoc(doc(db, 'notifications', notifId), {
      id: notifId,
      user_id: params.recipientId,
      actor_id: params.actor.id,
      actor_username: params.actor.username,
      actor_display_name: params.actor.display_name.slice(0, 80),
      actor_avatar_url: (params.actor.avatar_url || '').slice(0, 350000),
      actor_verified: !!params.actor.is_verified,
      type: params.type,
      target_id: params.targetId.slice(0, 256),
      read: false,
      created_at: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

function syncLeaderboardCacheEntry(entry: LeaderboardEntry) {
  if (leaderboardMemoryCache) {
    const exists = leaderboardMemoryCache.entries.some((e) => e.user_id === entry.user_id);
    const updated = (
      exists
        ? leaderboardMemoryCache.entries.map((e) => (e.user_id === entry.user_id ? entry : e))
        : [...leaderboardMemoryCache.entries, entry]
    ).sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.interactions_count !== a.interactions_count) return b.interactions_count - a.interactions_count;
      return a.display_name.localeCompare(b.display_name);
    });
    leaderboardMemoryCache = { ...leaderboardMemoryCache, entries: updated, ts: Date.now() };
    try {
      localStorage.setItem(
        LEADERBOARD_STORAGE_KEY,
        JSON.stringify({ epoch: leaderboardMemoryCache.epoch, entries: updated.slice(0, 50), ts: Date.now() })
      );
    } catch {}
  }
}

async function awardSyncPointsInternal(
  uid: string,
  action: 'post' | 'comment' | 'repost' | 'quote' | 'story'
): Promise<LeaderboardEntry | null> {
  if (!uid) return null;
  const actor = await getFastActorDoc(uid).catch(() => null);
  if (!actor) return null;

  const today = getTodayUtcDay(0);
  const yesterday = getTodayUtcDay(-1);
  const spRef = doc(db, 'sync_points', uid);
  const userRef = doc(db, 'users', uid);

  try {
    let earnedActionSp = 0;
    let earnedDailyBonus = 0;
    let isUltra = !!actor.is_verified;

    const finalEntry = await runTransaction(db, async (tx) => {
      const [spSnap, userSnap] = await Promise.all([tx.get(spRef), tx.get(userRef)]);
      isUltra = userSnap.exists() ? !!userSnap.data().is_verified : !!actor.is_verified;
      const multiplier = isUltra ? 2 : 1;
      const baseActionSp = (SP_VALUES[action] || 10) * multiplier;
      earnedActionSp = baseActionSp;

      if (!spSnap.exists()) {
        earnedDailyBonus = DAILY_BONUS_SP * multiplier;
        const totalNew = earnedDailyBonus + baseActionSp;
        const entry: LeaderboardEntry = {
          user_id: uid,
          username: actor.username,
          display_name: actor.display_name,
          avatar_url: actor.avatar_url || '',
          is_verified: isUltra,
          points: totalNew,
          daily_unlocked_day: today,
          streak_days: 1,
          interactions_count: 1,
          updated_at: new Date().toISOString(),
        };
        tx.set(spRef, {
          ...entry,
          updated_at: serverTimestamp(),
        });
        return entry;
      }

      const d = spSnap.data();
      const prevPoints = typeof d.points === 'number' ? d.points : 0;
      const prevDay = typeof d.daily_unlocked_day === 'string' ? d.daily_unlocked_day : '';
      const prevStreak = typeof d.streak_days === 'number' ? d.streak_days : 0;
      const prevInteractions = typeof d.interactions_count === 'number' ? d.interactions_count : 0;

      const unlockedToday = prevDay === today;
      earnedDailyBonus = unlockedToday ? 0 : DAILY_BONUS_SP * multiplier;
      const nextPoints = prevPoints + earnedDailyBonus + baseActionSp;
      const nextStreak = unlockedToday
        ? Math.max(1, prevStreak)
        : prevDay === yesterday
        ? prevStreak + 1
        : 1;

      tx.update(spRef, {
        username: actor.username,
        display_name: actor.display_name,
        avatar_url: actor.avatar_url || '',
        points: nextPoints,
        daily_unlocked_day: today,
        streak_days: nextStreak,
        interactions_count: prevInteractions + 1,
        updated_at: serverTimestamp(),
      });

      const updatedEntry: LeaderboardEntry = {
        user_id: uid,
        username: actor.username,
        display_name: actor.display_name,
        avatar_url: actor.avatar_url || '',
        is_verified: isUltra,
        points: nextPoints,
        daily_unlocked_day: today,
        streak_days: nextStreak,
        interactions_count: prevInteractions + 1,
        updated_at: new Date().toISOString(),
      };
      return updatedEntry;
    });

    try {
      localStorage.setItem(`${MY_SP_STORAGE_PREFIX}${uid}`, JSON.stringify(finalEntry));
    } catch {}
    syncLeaderboardCacheEntry(finalEntry);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('sync:sp-updated', { detail: finalEntry }));
      window.dispatchEvent(
        new CustomEvent('sync:sp-earned', {
          detail: {
            action,
            baseActionSp: earnedActionSp,
            dailyBonus: earnedDailyBonus,
            totalEarned: earnedActionSp + earnedDailyBonus,
            isUltra,
            entry: finalEntry,
          },
        })
      );
    }
    return finalEntry;
  } catch {
    return null;
  }
}

async function hydratePosts(rawDocs: any[], currentUid?: string): Promise<Post[]> {
  if (rawDocs.length === 0) return [];
  if (currentUid && liveEngUid === currentUid && liveLikesReady && liveBookmarksReady) {
    return mapRawDocsToPosts(rawDocs, liveLikedPostIds, liveBookmarkedPostIds);
  }

  const likedSet = new Set<string>();
  const bookmarkedSet = new Set<string>();

  if (currentUid) {
    try {
      const [likeSnap, bmkSnap] = await Promise.all([
        getDocs(query(collection(db, 'likes'), where('user_id', '==', currentUid))),
        getDocs(query(collection(db, 'bookmarks'), where('user_id', '==', currentUid))),
      ]);
      likeSnap.docs.forEach((docSnap) => {
        const pid = docSnap.data().post_id;
        if (pid) likedSet.add(pid);
      });
      bmkSnap.docs.forEach((docSnap) => {
        const pid = docSnap.data().post_id;
        if (pid) bookmarkedSet.add(pid);
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'likes');
    }
  }

  return mapRawDocsToPosts(rawDocs, likedSet, bookmarkedSet);
}

export const api = {
  getCachedMe,
  saveCachedMe,
  clearCachedMe,
  clearAccountSwitchCaches,
  getCachedHasPassword,
  saveCachedHasPassword,

  // Auth
  getMe: async (prefetchedUser?: User): Promise<{ user: User; counts: { unreadNotifications: number; unreadMessages: number } }> => {
    const fbUser = auth.currentUser;
    if (!fbUser) throw new Error('Not signed in');
    const user = prefetchedUser || (await ensureUserProfile(fbUser));

    let unreadNotifications = 0;
    let unreadMessages = 0;

    const [notifResult, convResult] = await Promise.all([
      getDocs(query(collection(db, 'notifications'), where('user_id', '==', user.id))).catch((err) => {
        handleFirestoreError(err, OperationType.LIST, 'notifications');
      }),
      getDocs(query(collection(db, 'conversations'), where('member_ids', 'array-contains', user.id))).catch((err) => {
        handleFirestoreError(err, OperationType.LIST, 'conversations');
      }),
    ]);

    if (notifResult) {
      unreadNotifications = notifResult.docs.filter((d) => !d.data().read).length;
    }

    if (convResult) {
      const candidateConvs = convResult.docs.filter((cDoc) => {
        const cData = cDoc.data();
        return cData.last_message_sender && cData.last_message_sender !== user.id && cData.last_message_time;
      });
      if (candidateConvs.length > 0) {
        const readSnaps = await Promise.all(
          candidateConvs.map((cDoc) =>
            getDoc(doc(db, 'conversations', cDoc.id, 'reads', user.id)).catch(() => null)
          )
        );
        candidateConvs.forEach((cDoc, idx) => {
          const cData = cDoc.data();
          const readSnap = readSnaps[idx];
          const lastRead = readSnap && readSnap.exists() ? toIsoString(readSnap.data().last_read_at) : '';
          const msgTime = toIsoString(cData.last_message_time);
          if (!lastRead || new Date(msgTime).getTime() > new Date(lastRead).getTime()) {
            unreadMessages += 1;
          }
        });
      }
    }

    return { user, counts: { unreadNotifications, unreadMessages } };
  },

  updateProfile: async (data: Partial<User>): Promise<{ user: User }> => {
    const uid = requireUid();
    const current = await getUserDocById(uid);
    if (!current) throw new Error('Profile not found');

    const keys = Object.keys(data).filter((k) => (data as any)[k] !== undefined);
    const isPrivacyOnlyUpdate = keys.length === 1 && keys[0] === 'is_private';

    if (isPrivacyOnlyUpdate) {
      const nextPrivate = !!data.is_private;
      const path = `users/${uid}`;
      try {
        await updateDoc(doc(db, 'users', uid), {
          is_private: nextPrivate,
          updated_at: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, path);
      }
      const updated = cacheUser({
        ...current,
        is_private: nextPrivate,
        email: auth.currentUser?.email || current.email || undefined,
      })!;
      saveCachedMe(updated);
      saveStoredProfile(updated.username.toLowerCase(), updated);
      return { user: updated };
    }

    let nextUsername = current.username;
    if (data.username !== undefined && data.username.trim()) {
      const candidate = sanitizeUsername(data.username);
      if (candidate !== current.username) {
        const existingSnap = await getDocs(
          query(collection(db, 'users'), where('username_lower', '==', candidate), limit(1))
        );
        if (!existingSnap.empty && existingSnap.docs[0].id !== uid) {
          throw new Error('Username is already taken.');
        }
        nextUsername = candidate;
      }
    }

    const nextDisplayName = (data.display_name ?? current.display_name).trim().slice(0, 80) || current.display_name;
    const nextBio = (data.bio ?? current.bio).slice(0, 500);
    const nextAvatar = ((data.avatar_url ?? current.avatar_url) || '').slice(0, 350000);
    const nextBanner = ((data.banner_url ?? current.banner_url) || '').slice(0, 450000);
    const nextWebsite = ((data.website ?? current.website) || '').slice(0, 200);
    const nextLocation = ((data.location ?? current.location) || '').slice(0, 100);
    const nextPrivate = data.is_private !== undefined ? !!data.is_private : !!current.is_private;

    const authorSnapshotChanged =
      nextUsername !== current.username ||
      nextDisplayName !== current.display_name ||
      nextAvatar !== (current.avatar_url || '');

    const path = `users/${uid}`;
    try {
      await updateDoc(doc(db, 'users', uid), {
        username: nextUsername,
        username_lower: nextUsername,
        display_name: nextDisplayName,
        bio: nextBio,
        avatar_url: nextAvatar,
        banner_url: nextBanner,
        website: nextWebsite,
        location: nextLocation,
        is_private: nextPrivate,
        updated_at: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }

    // Best-effort sync of author snapshot on user's posts, active stories, and sync_points when identity fields change
    if (authorSnapshotChanged) {
      getDocs(query(collection(db, 'posts'), where('user_id', '==', uid)))
        .then((userPostsSnap) => {
          if (userPostsSnap.empty) return;
          const batch = writeBatch(db);
          userPostsSnap.docs.slice(0, 100).forEach((pDoc) => {
            batch.update(pDoc.ref, {
              username: nextUsername,
              display_name: nextDisplayName,
              avatar_url: nextAvatar,
              updated_at: serverTimestamp(),
            });
          });
          return batch.commit();
        })
        .catch(() => {});

      getDocs(query(collection(db, 'stories'), where('user_id', '==', uid)))
        .then((storiesSnap) => {
          if (storiesSnap.empty) return;
          const batch = writeBatch(db);
          storiesSnap.docs.slice(0, 50).forEach((sDoc) => {
            batch.update(sDoc.ref, {
              username: nextUsername,
              display_name: nextDisplayName,
              avatar_url: nextAvatar,
            });
          });
          return batch.commit();
        })
        .catch(() => {});

      updateDoc(doc(db, 'sync_points', uid), {
        username: nextUsername,
        display_name: nextDisplayName,
        avatar_url: nextAvatar,
        updated_at: serverTimestamp(),
      }).catch(() => {});
    }

    invalidateUserCache(uid, current.username);
    const updatedUser = cacheUser({
      ...current,
      username: nextUsername,
      display_name: nextDisplayName,
      bio: nextBio,
      avatar_url: nextAvatar,
      banner_url: nextBanner,
      website: nextWebsite,
      location: nextLocation,
      is_private: nextPrivate,
      email: auth.currentUser?.email || current.email || undefined,
    })!;

    saveCachedMe(updatedUser);
    saveStoredProfile(updatedUser.username.toLowerCase(), updatedUser);
    patchAllCachesForUser(updatedUser, current.username);
    return { user: updatedUser };
  },

  // Media (client-side compression for persistent Firestore storage)
  uploadImage: async (base64OrUrl: string): Promise<{ url: string }> => {
    if (base64OrUrl.startsWith('http://') || base64OrUrl.startsWith('https://')) {
      return { url: base64OrUrl };
    }
    const compressed = await compressDataUrl(base64OrUrl, 1080, 260000);
    return { url: compressed };
  },

  // Posts & Feed
  getCachedPosts: (params?: { feed?: string; tag?: string }): Post[] | null => {
    return loadFeedCache(getFeedKey(params));
  },

  getPosts: async (params?: { feed?: string; tag?: string }): Promise<{ posts: Post[] }> => {
    if (!auth.currentUser && getCachedMe() && typeof (auth as any).authStateReady === 'function') {
      await (auth as any).authStateReady();
    }
    const currentUid = auth.currentUser?.uid;
    const feed = params?.feed || 'for_you';
    const tag = params?.tag?.replace('#', '').toLowerCase();
    const cacheKey = getFeedKey(params);

    let rows: any[] = [];
    let blockedIds = new Set<string>();
    let followingIds = new Set<string>();

    const [postsSnap, blocksSnap, folSnap] = await Promise.all([
      getDocs(query(collection(db, 'posts'), orderBy('created_at', 'desc'), limit(40))).catch((err) => {
        handleFirestoreError(err, OperationType.LIST, 'posts');
      }),
      currentUid
        ? getDocs(query(collection(db, 'blocks'), where('blocker_id', '==', currentUid))).catch((err) => {
            handleFirestoreError(err, OperationType.LIST, 'blocks');
          })
        : Promise.resolve(null),
      currentUid && feed === 'following'
        ? getDocs(query(collection(db, 'follows'), where('follower_id', '==', currentUid))).catch((err) => {
            handleFirestoreError(err, OperationType.LIST, 'follows');
          })
        : Promise.resolve(null),
    ]);

    if (postsSnap) {
      rows = postsSnap.docs.map((d) => ({ ...d.data(), id: d.id }));
    }
    if (blocksSnap) {
      blockedIds = new Set(blocksSnap.docs.map((d) => d.data().blocked_id));
      rows = rows.filter((p) => !blockedIds.has(p.user_id));
    }
    if (folSnap && currentUid) {
      followingIds = new Set(folSnap.docs.map((d) => d.data().following_id));
      followingIds.add(currentUid);
      rows = rows.filter((p) => followingIds.has(p.user_id));
    }

    if (tag) {
      rows = rows.filter((p) => (p.content || '').toLowerCase().includes(`#${tag}`));
    }

    const posts = await hydratePosts(rows, currentUid);
    saveFeedCache(cacheKey, posts);
    return { posts };
  },

  getPost: async (id: string): Promise<{ post: Post }> => {
    const path = `posts/${id}`;
    let data: any;
    try {
      const snap = await getDoc(doc(db, 'posts', id));
      if (!snap.exists()) throw new Error('Post not found');
      data = { ...snap.data(), id: snap.id };
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, path);
    }
    const [post] = await hydratePosts([data], auth.currentUser?.uid);
    return { post };
  },

  createPost: async (
    content: string,
    images?: string[],
    quoteTarget?: Post | null,
    onOptimistic?: (post: Post) => void
  ): Promise<{ post: Post }> => {
    const uid = requireUid();
    const author = await getFastActorDoc(uid);
    if (!author) throw new Error('Profile not found');

    const safeContent = (content || '').trim().slice(0, 2000);
    const safeImages = (images || []).slice(0, 4).map((img) => img.slice(0, 450000));
    if (!safeContent && safeImages.length === 0 && !quoteTarget) {
      throw new Error('Post must have content or images');
    }

    const mentions = extractMentions(safeContent);
    const postId = genId('post');
    const path = `posts/${postId}`;
    const postPayload: Record<string, any> = {
      id: postId,
      user_id: uid,
      username: author.username,
      display_name: author.display_name,
      avatar_url: author.avatar_url || '',
      is_verified: false,
      content: safeContent,
      images: safeImages,
      likes_count: 0,
      comments_count: 0,
      reposts_count: 0,
      is_pinned: false,
      pinned_at: null,
      hide_likes: false,
      comments_disabled: false,
      mentions,
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    };

    if (quoteTarget) {
      postPayload.is_repost = false;
      postPayload.repost_of_id = quoteTarget.id;
      postPayload.repost_of_user = (quoteTarget.username || '').slice(0, 20);
      postPayload.repost_of_display_name = (quoteTarget.display_name || '').slice(0, 80);
      postPayload.repost_of_content = (quoteTarget.content || '').slice(0, 1000);
      postPayload.repost_of_image = quoteTarget.images?.[0] ? quoteTarget.images[0].slice(0, 450000) : null;
    }

    const createdPost: Post = {
      id: postId,
      user_id: uid,
      username: author.username,
      display_name: author.display_name,
      avatar_url: author.avatar_url || '',
      is_verified: !!author.is_verified,
      content: safeContent,
      images: safeImages,
      likes_count: 0,
      comments_count: 0,
      reposts_count: 0,
      is_repost: false,
      repost_of_id: quoteTarget ? quoteTarget.id : null,
      repost_of_user: quoteTarget ? quoteTarget.username : null,
      repost_of_display_name: quoteTarget ? quoteTarget.display_name : null,
      repost_of_content: quoteTarget ? (quoteTarget.content || '').slice(0, 1000) : null,
      repost_of_image: quoteTarget?.images?.[0] || null,
      is_pinned: false,
      pinned_at: null,
      hide_likes: false,
      comments_disabled: false,
      mentions,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      is_liked: false,
      is_bookmarked: false,
    };

    // Instant 0ms optimistic appearance across all views
    prependPostToCaches(createdPost);
    if (quoteTarget) {
      patchPostEngagementInCaches(quoteTarget.id, {
        reposts_count: (quoteTarget.reposts_count || 0) + 1,
      });
    }
    onOptimistic?.(createdPost);

    try {
      if (quoteTarget) {
        const batch = writeBatch(db);
        batch.set(doc(db, 'posts', postId), postPayload);
        batch.update(doc(db, 'posts', quoteTarget.id), {
          reposts_count: increment(1),
          updated_at: serverTimestamp(),
        });
        await batch.commit();
      } else {
        await setDoc(doc(db, 'posts', postId), postPayload);
      }
    } catch (err) {
      removePostFromCaches(postId);
      if (quoteTarget) {
        patchPostEngagementInCaches(quoteTarget.id, {
          reposts_count: quoteTarget.reposts_count || 0,
        });
      }
      handleFirestoreError(err, OperationType.CREATE, path);
    }

    if (quoteTarget && quoteTarget.user_id && quoteTarget.user_id !== uid) {
      createNotificationDoc({
        recipientId: quoteTarget.user_id,
        actor: author,
        type: 'quote',
        targetId: postId,
      }).catch(() => {});
    }
    if (mentions.length > 0) {
      const selfLower = author.username.toLowerCase();
      Promise.all(
        mentions
          .filter((uname) => uname !== selfLower)
          .slice(0, 5)
          .map(async (uname) => {
            const mentioned = await getUserDocByUsername(uname).catch(() => null);
            if (mentioned && mentioned.id !== uid && mentioned.id !== quoteTarget?.user_id) {
              await createNotificationDoc({
                recipientId: mentioned.id,
                actor: author,
                type: 'mention',
                targetId: postId,
              });
            }
          })
      ).catch(() => {});
    }
    awardSyncPointsInternal(uid, quoteTarget ? 'quote' : 'post').catch(() => {});
    return { post: createdPost };
  },

  repostPost: async (targetPost: Post): Promise<{ post: Post }> => {
    const uid = requireUid();
    const author = await getFastActorDoc(uid);
    if (!author) throw new Error('Profile not found');

    const rootId = targetPost.repost_of_id && targetPost.is_repost ? targetPost.repost_of_id : targetPost.id;
    const rootUser = targetPost.repost_of_id && targetPost.is_repost ? (targetPost.repost_of_user || targetPost.username) : targetPost.username;
    const rootDisplayName = targetPost.repost_of_id && targetPost.is_repost ? (targetPost.repost_of_display_name || targetPost.display_name) : targetPost.display_name;
    const rootContent = targetPost.repost_of_id && targetPost.is_repost ? (targetPost.repost_of_content || '') : (targetPost.content || '');
    const rootImage = targetPost.repost_of_id && targetPost.is_repost ? (targetPost.repost_of_image || null) : (targetPost.images?.[0] || null);

    const postId = genId('post');
    const path = `posts/${postId}`;
    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'posts', postId), {
        id: postId,
        user_id: uid,
        username: author.username,
        display_name: author.display_name,
        avatar_url: author.avatar_url || '',
        is_verified: false,
        content: '',
        images: [],
        likes_count: 0,
        comments_count: 0,
        reposts_count: 0,
        is_repost: true,
        repost_of_id: rootId,
        repost_of_user: rootUser.slice(0, 20),
        repost_of_display_name: rootDisplayName.slice(0, 80),
        repost_of_content: rootContent.slice(0, 1000),
        repost_of_image: rootImage ? rootImage.slice(0, 450000) : null,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      });
      batch.update(doc(db, 'posts', targetPost.id), {
        reposts_count: increment(1),
        updated_at: serverTimestamp(),
      });
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    }

    const createdPost: Post = {
      id: postId,
      user_id: uid,
      username: author.username,
      display_name: author.display_name,
      avatar_url: author.avatar_url || '',
      is_verified: !!author.is_verified,
      content: '',
      images: [],
      likes_count: 0,
      comments_count: 0,
      reposts_count: 0,
      is_repost: true,
      repost_of_id: rootId,
      repost_of_user: rootUser,
      repost_of_display_name: rootDisplayName,
      repost_of_content: rootContent.slice(0, 1000),
      repost_of_image: rootImage,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      is_liked: false,
      is_bookmarked: false,
    };

    prependPostToCaches(createdPost);
    patchPostEngagementInCaches(targetPost.id, {
      reposts_count: (targetPost.reposts_count || 0) + 1,
    });
    if (targetPost.user_id && targetPost.user_id !== uid) {
      createNotificationDoc({
        recipientId: targetPost.user_id,
        actor: author,
        type: 'repost',
        targetId: targetPost.id,
      }).catch(() => {});
    }
    awardSyncPointsInternal(uid, 'repost').catch(() => {});
    return { post: createdPost };
  },

  updatePost: async (id: string, content: string): Promise<{ success: boolean; content: string; mentions: string[] }> => {
    requireUid();
    const safeContent = (content || '').trim().slice(0, 2000);
    const mentions = extractMentions(safeContent);
    const path = `posts/${id}`;
    try {
      await updateDoc(doc(db, 'posts', id), {
        content: safeContent,
        mentions,
        updated_at: serverTimestamp(),
      });
      patchPostEngagementInCaches(id, { content: safeContent, mentions });
      return { success: true, content: safeContent, mentions };
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  },

  togglePinPost: async (postId: string, isPinned: boolean): Promise<{ is_pinned: boolean; pinned_at: string | null }> => {
    const uid = requireUid();
    if (isPinned) {
      const snap = await getDocs(query(collection(db, 'posts'), where('user_id', '==', uid)));
      const pinnedCount = snap.docs.filter((d) => d.id !== postId && !!d.data().is_pinned).length;
      if (pinnedCount >= 3) {
        throw new Error('You can pin up to 3 posts on your profile.');
      }
    }
    const path = `posts/${postId}`;
    try {
      await updateDoc(doc(db, 'posts', postId), {
        is_pinned: isPinned,
        pinned_at: isPinned ? serverTimestamp() : null,
        updated_at: serverTimestamp(),
      });
      const pinnedAt = isPinned ? new Date().toISOString() : null;
      patchPostEngagementInCaches(postId, { is_pinned: isPinned, pinned_at: pinnedAt });
      return { is_pinned: isPinned, pinned_at: pinnedAt };
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  },

  toggleHideLikes: async (postId: string, hideLikes: boolean): Promise<{ hide_likes: boolean }> => {
    requireUid();
    const path = `posts/${postId}`;
    try {
      await updateDoc(doc(db, 'posts', postId), {
        hide_likes: hideLikes,
        updated_at: serverTimestamp(),
      });
      patchPostEngagementInCaches(postId, { hide_likes: hideLikes });
      return { hide_likes: hideLikes };
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  },

  toggleCommentsDisabled: async (postId: string, disabled: boolean): Promise<{ comments_disabled: boolean }> => {
    requireUid();
    const path = `posts/${postId}`;
    try {
      await updateDoc(doc(db, 'posts', postId), {
        comments_disabled: disabled,
        updated_at: serverTimestamp(),
      });
      patchPostEngagementInCaches(postId, { comments_disabled: disabled });
      return { comments_disabled: disabled };
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  },

  deletePost: async (id: string): Promise<{ success: boolean }> => {
    requireUid();
    const path = `posts/${id}`;
    removePostFromCaches(id);
    try {
      await deleteDoc(doc(db, 'posts', id));
      return { success: true };
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  },

  likePost: async (
    id: string,
    knownLikesCount?: number,
    knownOwnerId?: string
  ): Promise<{ liked: boolean; likes_count?: number }> => {
    const uid = requireUid();
    const likeId = `${id}__${uid}`;
    const likeRef = doc(db, 'likes', likeId);
    const postRef = doc(db, 'posts', id);

    // 0ms optimistic engagement & cache sync
    liveLikedPostIds.add(id);
    const optimisticCount = typeof knownLikesCount === 'number' ? knownLikesCount + 1 : undefined;
    patchPostEngagementInCaches(id, {
      is_liked: true,
      ...(typeof optimisticCount === 'number' ? { likes_count: optimisticCount } : {}),
    });

    try {
      const batch = writeBatch(db);
      batch.set(likeRef, {
        id: likeId,
        user_id: uid,
        post_id: id,
        created_at: serverTimestamp(),
      });
      batch.update(postRef, {
        likes_count: increment(1),
        updated_at: serverTimestamp(),
      });
      await batch.commit();
    } catch (batchErr) {
      // Fallback transaction if state was out-of-sync (e.g. already liked)
      try {
        await runTransaction(db, async (tx) => {
          const [likeSnap, postSnap] = await Promise.all([tx.get(likeRef), tx.get(postRef)]);
          if (!postSnap.exists()) throw new Error('Post not found');
          if (likeSnap.exists()) return;
          const currentCount = typeof postSnap.data().likes_count === 'number' ? postSnap.data().likes_count : 0;
          tx.set(likeRef, {
            id: likeId,
            user_id: uid,
            post_id: id,
            created_at: serverTimestamp(),
          });
          tx.update(postRef, {
            likes_count: currentCount + 1,
            updated_at: serverTimestamp(),
          });
        });
      } catch (err) {
        liveLikedPostIds.delete(id);
        patchPostEngagementInCaches(id, {
          is_liked: false,
          ...(typeof knownLikesCount === 'number' ? { likes_count: knownLikesCount } : {}),
        });
        handleFirestoreError(err || batchErr, OperationType.WRITE, `likes/${likeId}`);
      }
    }

    // Non-blocking notification in background
    (async () => {
      let recipientId = knownOwnerId;
      if (!recipientId) {
        const pSnap = await getDoc(postRef).catch(() => null);
        recipientId = pSnap?.data()?.user_id;
      }
      if (recipientId && recipientId !== uid) {
        const actor = await getFastActorDoc(uid);
        if (actor) {
          await createNotificationDoc({
            recipientId,
            actor,
            type: 'like',
            targetId: id,
          });
        }
      }
    })().catch(() => {});

    return { liked: true, likes_count: optimisticCount };
  },

  unlikePost: async (id: string, knownLikesCount?: number): Promise<{ liked: boolean; likes_count?: number }> => {
    const uid = requireUid();
    const likeId = `${id}__${uid}`;
    const likeRef = doc(db, 'likes', likeId);
    const postRef = doc(db, 'posts', id);

    // 0ms optimistic engagement & cache sync
    liveLikedPostIds.delete(id);
    const optimisticCount = typeof knownLikesCount === 'number' ? Math.max(0, knownLikesCount - 1) : undefined;
    patchPostEngagementInCaches(id, {
      is_liked: false,
      ...(typeof optimisticCount === 'number' ? { likes_count: optimisticCount } : {}),
    });

    try {
      if (knownLikesCount === 0) {
        await deleteDoc(likeRef);
      } else {
        const batch = writeBatch(db);
        batch.delete(likeRef);
        batch.update(postRef, {
          likes_count: increment(-1),
          updated_at: serverTimestamp(),
        });
        await batch.commit();
      }
    } catch {
      try {
        await runTransaction(db, async (tx) => {
          const [likeSnap, postSnap] = await Promise.all([tx.get(likeRef), tx.get(postRef)]);
          if (!likeSnap.exists()) return;
          tx.delete(likeRef);
          if (postSnap.exists()) {
            const currentCount = typeof postSnap.data().likes_count === 'number' ? postSnap.data().likes_count : 0;
            if (currentCount > 0) {
              tx.update(postRef, {
                likes_count: currentCount - 1,
                updated_at: serverTimestamp(),
              });
            }
          }
        });
      } catch (err) {
        liveLikedPostIds.add(id);
        patchPostEngagementInCaches(id, {
          is_liked: true,
          ...(typeof knownLikesCount === 'number' ? { likes_count: knownLikesCount } : {}),
        });
        handleFirestoreError(err, OperationType.WRITE, `likes/${likeId}`);
      }
    }

    return { liked: false, likes_count: optimisticCount };
  },

  getPostLikes: async (id: string): Promise<{ users: User[] }> => {
    try {
      const snap = await getDocs(query(collection(db, 'likes'), where('post_id', '==', id)));
      const userDocs = await Promise.all(snap.docs.map((d) => getUserDocById(d.data().user_id)));
      return { users: userDocs.filter((u): u is User => u !== null) };
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'likes');
    }
  },

  bookmarkPost: async (id: string): Promise<{ bookmarked: boolean }> => {
    const uid = requireUid();
    const bId = `${id}__${uid}`;
    liveBookmarkedPostIds.add(id);
    patchPostEngagementInCaches(id, { is_bookmarked: true });
    try {
      await setDoc(doc(db, 'bookmarks', bId), {
        id: bId,
        user_id: uid,
        post_id: id,
        created_at: serverTimestamp(),
      });
      bookmarksMemoryCache = null;
      return { bookmarked: true };
    } catch (err) {
      liveBookmarkedPostIds.delete(id);
      patchPostEngagementInCaches(id, { is_bookmarked: false });
      handleFirestoreError(err, OperationType.CREATE, `bookmarks/${bId}`);
    }
  },

  unbookmarkPost: async (id: string): Promise<{ bookmarked: boolean }> => {
    const uid = requireUid();
    const bId = `${id}__${uid}`;
    liveBookmarkedPostIds.delete(id);
    patchPostEngagementInCaches(id, { is_bookmarked: false });
    if (bookmarksMemoryCache && bookmarksMemoryCache.uid === uid) {
      bookmarksMemoryCache.posts = bookmarksMemoryCache.posts.filter((p) => p.id !== id);
    }
    try {
      await deleteDoc(doc(db, 'bookmarks', bId));
      return { bookmarked: false };
    } catch (err) {
      liveBookmarkedPostIds.add(id);
      patchPostEngagementInCaches(id, { is_bookmarked: true });
      handleFirestoreError(err, OperationType.DELETE, `bookmarks/${bId}`);
    }
  },

  getCachedBookmarks: (): Post[] | null => {
    const uid = auth.currentUser?.uid || getCachedMe()?.id;
    if (!uid || !bookmarksMemoryCache || bookmarksMemoryCache.uid !== uid) return null;
    return bookmarksMemoryCache.posts;
  },

  getBookmarks: async (): Promise<{ posts: Post[] }> => {
    const uid = await getAuthenticatedUid();
    try {
      const snap = await getDocs(query(collection(db, 'bookmarks'), where('user_id', '==', uid)));
      const sorted = snap.docs
        .map((d) => d.data())
        .sort((a, b) => new Date(toIsoString(b.created_at)).getTime() - new Date(toIsoString(a.created_at)).getTime());

      const postSnaps = await Promise.all(sorted.map((b) => getDoc(doc(db, 'posts', b.post_id))));
      const rawPosts = postSnaps.filter((s) => s.exists()).map((s) => ({ ...s.data(), id: s.id }));
      const posts = await hydratePosts(rawPosts, uid);
      bookmarksMemoryCache = { uid, posts, ts: Date.now() };
      return { posts };
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'bookmarks');
    }
  },

  // Comments
  getComments: async (postId: string): Promise<{ comments: Comment[] }> => {
    const currentUid = auth.currentUser?.uid;
    try {
      const [snap, likesSnap] = await Promise.all([
        getDocs(query(collection(db, 'comments'), where('post_id', '==', postId))),
        currentUid
          ? getDocs(query(collection(db, 'comment_likes'), where('user_id', '==', currentUid))).catch(() => null)
          : Promise.resolve(null),
      ]);
      const likedIds = new Set<string>();
      if (likesSnap) {
        likesSnap.docs.forEach((d) => {
          const cid = d.data().comment_id;
          if (cid) likedIds.add(cid);
        });
      }
      const comments: Comment[] = snap.docs
        .map((d) => {
          const data = d.data();
          return {
            id: d.id,
            post_id: data.post_id,
            user_id: data.user_id,
            parent_id: data.parent_id || null,
            content: data.content,
            likes_count: data.likes_count || 0,
            is_liked: likedIds.has(d.id),
            created_at: toIsoString(data.created_at),
            username: data.username,
            display_name: data.display_name,
            avatar_url: data.avatar_url || '',
            is_verified: !!data.is_verified,
          };
        })
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      return { comments };
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'comments');
    }
  },

  likeComment: async (commentId: string, knownLikesCount?: number): Promise<{ liked: boolean; likes_count: number }> => {
    const uid = requireUid();
    const likeId = `${commentId}__${uid}`;
    const likeRef = doc(db, 'comment_likes', likeId);
    const cmtRef = doc(db, 'comments', commentId);
    let finalCount = typeof knownLikesCount === 'number' ? knownLikesCount + 1 : 1;
    liveLikedCommentIds.add(commentId);
    try {
      await runTransaction(db, async (tx) => {
        const [likeSnap, cmtSnap] = await Promise.all([tx.get(likeRef), tx.get(cmtRef)]);
        if (!cmtSnap.exists()) throw new Error('Comment not found');
        const cur = typeof cmtSnap.data().likes_count === 'number' ? cmtSnap.data().likes_count : 0;
        if (likeSnap.exists()) {
          finalCount = cur;
          return;
        }
        finalCount = cur + 1;
        tx.set(likeRef, {
          id: likeId,
          user_id: uid,
          comment_id: commentId,
          created_at: serverTimestamp(),
        });
        tx.update(cmtRef, { likes_count: finalCount });
      });
      return { liked: true, likes_count: finalCount };
    } catch (err) {
      liveLikedCommentIds.delete(commentId);
      handleFirestoreError(err, OperationType.WRITE, `comment_likes/${likeId}`);
    }
  },

  unlikeComment: async (commentId: string, knownLikesCount?: number): Promise<{ liked: boolean; likes_count: number }> => {
    const uid = requireUid();
    const likeId = `${commentId}__${uid}`;
    const likeRef = doc(db, 'comment_likes', likeId);
    const cmtRef = doc(db, 'comments', commentId);
    let finalCount = typeof knownLikesCount === 'number' ? Math.max(0, knownLikesCount - 1) : 0;
    liveLikedCommentIds.delete(commentId);
    try {
      await runTransaction(db, async (tx) => {
        const [likeSnap, cmtSnap] = await Promise.all([tx.get(likeRef), tx.get(cmtRef)]);
        if (!likeSnap.exists()) {
          if (cmtSnap.exists()) {
            finalCount = typeof cmtSnap.data().likes_count === 'number' ? cmtSnap.data().likes_count : 0;
          }
          return;
        }
        tx.delete(likeRef);
        if (cmtSnap.exists()) {
          const cur = typeof cmtSnap.data().likes_count === 'number' ? cmtSnap.data().likes_count : 0;
          finalCount = Math.max(0, cur - 1);
          if (cur > 0) {
            tx.update(cmtRef, { likes_count: finalCount });
          }
        }
      });
      return { liked: false, likes_count: finalCount };
    } catch (err) {
      liveLikedCommentIds.add(commentId);
      handleFirestoreError(err, OperationType.WRITE, `comment_likes/${likeId}`);
    }
  },

  createComment: async (
    postId: string,
    content: string,
    parentId?: string | null,
    knownPostOwnerId?: string,
    knownCommentsCount?: number
  ): Promise<{ comment: Comment; comments_count?: number }> => {
    const uid = requireUid();
    const safeContent = (content || '').trim().slice(0, 1000);
    if (!safeContent) throw new Error('Comment content cannot be empty');

    const actor = await getFastActorDoc(uid);
    if (!actor) throw new Error('Profile not found');

    const postRef = doc(db, 'posts', postId);
    const cmtId = genId('cmt');
    const cmtRef = doc(db, 'comments', cmtId);

    try {
      const batch = writeBatch(db);
      batch.set(cmtRef, {
        id: cmtId,
        post_id: postId,
        user_id: uid,
        parent_id: parentId || null,
        content: safeContent,
        likes_count: 0,
        username: actor.username,
        display_name: actor.display_name,
        avatar_url: actor.avatar_url || '',
        is_verified: false,
        created_at: serverTimestamp(),
      });
      batch.update(postRef, {
        comments_count: increment(1),
        updated_at: serverTimestamp(),
      });
      await batch.commit();

      const nextCount = typeof knownCommentsCount === 'number' ? knownCommentsCount + 1 : undefined;
      if (typeof nextCount === 'number') {
        patchPostEngagementInCaches(postId, { comments_count: nextCount });
      }

      // Non-blocking notifications & Daily Sync Points reward
      (async () => {
        let postOwnerId = knownPostOwnerId;
        if (!postOwnerId) {
          const pSnap = await getDoc(postRef).catch(() => null);
          postOwnerId = pSnap?.data()?.user_id;
        }
        if (postOwnerId && postOwnerId !== uid) {
          await createNotificationDoc({
            recipientId: postOwnerId,
            actor,
            type: 'comment',
            targetId: postId,
          });
        }
        if (parentId) {
          const parentSnap = await getDoc(doc(db, 'comments', parentId)).catch(() => null);
          if (parentSnap?.exists()) {
            const parentOwnerId = parentSnap.data().user_id;
            if (parentOwnerId && parentOwnerId !== uid && parentOwnerId !== postOwnerId) {
              await createNotificationDoc({
                recipientId: parentOwnerId,
                actor,
                type: 'reply',
                targetId: postId,
              });
            }
          }
        }
      })().catch(() => {});

      awardSyncPointsInternal(uid, 'comment').catch(() => {});

      return {
        comment: {
          id: cmtId,
          post_id: postId,
          user_id: uid,
          parent_id: parentId || null,
          content: safeContent,
          likes_count: 0,
          created_at: new Date().toISOString(),
          username: actor.username,
          display_name: actor.display_name,
          avatar_url: actor.avatar_url || '',
          is_verified: !!actor.is_verified,
        },
        comments_count: nextCount,
      };
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `comments/${cmtId}`);
    }
  },

  deleteComment: async (
    id: string,
    knownPostId?: string,
    knownCommentsCount?: number
  ): Promise<{ success: boolean; comments_count?: number }> => {
    requireUid();
    const cmtRef = doc(db, 'comments', id);
    try {
      if (knownPostId && knownCommentsCount !== 0) {
        const postRef = doc(db, 'posts', knownPostId);
        const batch = writeBatch(db);
        batch.delete(cmtRef);
        batch.update(postRef, {
          comments_count: increment(-1),
          updated_at: serverTimestamp(),
        });
        await batch.commit();
        const nextCount = typeof knownCommentsCount === 'number' ? Math.max(0, knownCommentsCount - 1) : undefined;
        if (typeof nextCount === 'number') {
          patchPostEngagementInCaches(knownPostId, { comments_count: nextCount });
        }
        return { success: true, comments_count: nextCount };
      }

      let nextCount: number | undefined;
      await runTransaction(db, async (tx) => {
        const cmtSnap = await tx.get(cmtRef);
        if (!cmtSnap.exists()) throw new Error('Comment not found');
        const targetPostId = cmtSnap.data().post_id;
        const postRef = doc(db, 'posts', targetPostId);
        const postSnap = await tx.get(postRef);

        tx.delete(cmtRef);
        if (postSnap.exists()) {
          const currentCount = typeof postSnap.data().comments_count === 'number' ? postSnap.data().comments_count : 0;
          if (currentCount > 0) {
            nextCount = currentCount - 1;
            tx.update(postRef, {
              comments_count: currentCount - 1,
              updated_at: serverTimestamp(),
            });
          } else {
            nextCount = 0;
          }
        }
      });

      return { success: true, comments_count: nextCount };
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `comments/${id}`);
    }
  },

  // Users & Profiles
  getCachedProfile: (username: string): User | null => {
    const clean = username.trim().toLowerCase();
    const currentUid = auth.currentUser?.uid || '';
    const cached = profileMemoryCache.get(clean);
    if (cached && (!currentUid || !cached.uid || cached.uid === currentUid)) {
      return cached.user;
    }
    const stored = loadStoredProfile(clean);
    if (stored) {
      cacheUser(stored);
      return stored;
    }
    const me = getCachedMe();
    if (me && me.username.toLowerCase() === clean) {
      return me;
    }
    return null;
  },

  getCachedUserPosts: (username: string): Post[] | null => {
    const clean = username.trim().toLowerCase();
    const currentUid = auth.currentUser?.uid || '';
    const cached = userPostsMemoryCache.get(clean);
    if (cached && (!currentUid || !cached.uid || cached.uid === currentUid)) {
      return cached.posts;
    }
    const stored = loadStoredUserPosts(clean);
    if (stored) return stored;
    const feedCached = loadFeedCache('for_you__');
    if (feedCached && feedCached.length > 0) {
      const matched = feedCached.filter((p) => (p.username || '').toLowerCase() === clean);
      if (matched.length > 0) return matched;
    }
    return null;
  },

  getCachedUserLikes: (username: string): Post[] | null => {
    const currentUid = auth.currentUser?.uid || '';
    const cached = userLikesMemoryCache.get(username.trim().toLowerCase());
    if (cached && (!currentUid || !cached.uid || cached.uid === currentUid)) return cached.posts;
    return null;
  },

  getProfile: async (username: string): Promise<{ user: User }> => {
    const clean = username.trim().toLowerCase();
    const profile = await getUserDocByUsername(username);
    if (!profile) throw new Error('User profile not found');
    const currentUid = auth.currentUser?.uid;

    let postsCount = 0;
    let followersCount = 0;
    let followingCount = 0;
    let isFollowing = false;
    let isPendingRequest = false;
    let isBlockedByMe = false;

    try {
      const [postsSnap, followersSnap, followingSnap, frSnap, blocksSnap] = await Promise.all([
        getDocs(query(collection(db, 'posts'), where('user_id', '==', profile.id))),
        getDocs(query(collection(db, 'follows'), where('following_id', '==', profile.id))),
        getDocs(query(collection(db, 'follows'), where('follower_id', '==', profile.id))),
        currentUid && currentUid !== profile.id
          ? getDocs(query(collection(db, 'follow_requests'), where('requester_id', '==', currentUid)))
          : Promise.resolve(null),
        currentUid && currentUid !== profile.id
          ? getDocs(query(collection(db, 'blocks'), where('blocker_id', '==', currentUid)))
          : Promise.resolve(null),
      ]);
      postsCount = postsSnap.size;
      followersCount = followersSnap.size;
      followingCount = followingSnap.size;

      if (currentUid) {
        isFollowing = followersSnap.docs.some((d) => d.data().follower_id === currentUid);
        if (!isFollowing && frSnap) {
          isPendingRequest = frSnap.docs.some((d) => d.data().target_id === profile.id && d.data().status === 'pending');
        }
        if (blocksSnap) {
          isBlockedByMe = blocksSnap.docs.some((d) => d.data().blocked_id === profile.id);
        }
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'follows');
    }

    const hydratedUser: User = {
      ...profile,
      posts_count: postsCount,
      followers_count: followersCount,
      following_count: followingCount,
      is_following: isFollowing,
      is_pending_request: isPendingRequest,
      is_blocked_by_me: isBlockedByMe,
      mutual_followers: [],
    };
    profileMemoryCache.set(clean, {
      uid: currentUid || '',
      user: hydratedUser,
      ts: Date.now(),
    });
    saveStoredProfile(clean, hydratedUser);
    if (currentUid && hydratedUser.id === currentUid) {
      saveCachedMe(hydratedUser);
    }
    return { user: hydratedUser };
  },

  getUserPosts: async (username: string): Promise<{ posts: Post[] }> => {
    const clean = username.trim().toLowerCase();
    const profile = await getUserDocByUsername(username);
    if (!profile) throw new Error('User not found');
    const currentUid = auth.currentUser?.uid;

    if (profile.is_private && profile.id !== currentUid) {
      if (!currentUid) throw new Error('Account is private.');
      const folSnap = await getDocs(query(collection(db, 'follows'), where('follower_id', '==', currentUid)));
      const isFol = folSnap.docs.some((d) => d.data().following_id === profile.id);
      if (!isFol) throw new Error('Account is private. Follow this account to see their posts.');
    }

    try {
      const snap = await getDocs(query(collection(db, 'posts'), where('user_id', '==', profile.id)));
      const raw = snap.docs
        .map((d) => ({ ...d.data(), id: d.id }))
        .sort((a: any, b: any) => new Date(toIsoString(b.created_at)).getTime() - new Date(toIsoString(a.created_at)).getTime());
      const posts = await hydratePosts(raw, currentUid);
      userPostsMemoryCache.set(clean, {
        uid: currentUid || '',
        posts,
        ts: Date.now(),
      });
      if (!profile.is_private || profile.id === currentUid) {
        saveStoredUserPosts(clean, posts);
      }
      return { posts };
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'posts');
    }
  },

  getUserLikes: async (username: string): Promise<{ posts: Post[] }> => {
    const profile = await getUserDocByUsername(username);
    if (!profile) throw new Error('User not found');
    const currentUid = auth.currentUser?.uid;
    try {
      const snap = await getDocs(query(collection(db, 'likes'), where('user_id', '==', profile.id)));
      const sorted = snap.docs
        .map((d) => d.data())
        .sort((a, b) => new Date(toIsoString(b.created_at)).getTime() - new Date(toIsoString(a.created_at)).getTime());
      const postSnaps = await Promise.all(sorted.map((l) => getDoc(doc(db, 'posts', l.post_id))));
      const raw = postSnaps.filter((s) => s.exists()).map((s) => ({ ...s.data(), id: s.id }));
      const posts = await hydratePosts(raw, currentUid);
      userLikesMemoryCache.set(username.trim().toLowerCase(), {
        uid: currentUid || '',
        posts,
        ts: Date.now(),
      });
      return { posts };
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'likes');
    }
  },

  getUserTaggedContent: async (username: string): Promise<{
    posts: Post[];
    stories: Array<{ story: Story; authorUsername: string; authorDisplayName: string; authorAvatar: string }>;
  }> => {
    const clean = username.trim().toLowerCase();
    const currentUid = auth.currentUser?.uid;
    try {
      const [postsSnap, storiesSnap] = await Promise.all([
        getDocs(query(collection(db, 'posts'), where('mentions', 'array-contains', clean))).catch(() => null),
        getDocs(
          query(
            collection(db, 'stories'),
            where('expires_at', '>', Timestamp.now()),
            orderBy('expires_at', 'desc'),
            limit(40)
          )
        ).catch(() => null),
      ]);

      const rawPosts = postsSnap
        ? postsSnap.docs
            .map((d) => ({ ...d.data(), id: d.id }))
            .sort((a: any, b: any) => new Date(toIsoString(b.created_at)).getTime() - new Date(toIsoString(a.created_at)).getTime())
        : [];
      const posts = await hydratePosts(rawPosts, currentUid);

      const nowMs = Date.now();
      const targetHandle = `@${clean}`;
      const taggedStories: Array<{ story: Story; authorUsername: string; authorDisplayName: string; authorAvatar: string }> = [];
      if (storiesSnap) {
        storiesSnap.docs.forEach((d) => {
          const s = d.data();
          const expIso = toIsoString(s.expires_at);
          if (new Date(expIso).getTime() <= nowMs) return;
          const tagsList: string[] = Array.isArray(s.tags) ? s.tags : [];
          if (tagsList.some((t) => t.toLowerCase() === targetHandle)) {
            taggedStories.push({
              story: {
                id: d.id,
                imageUrl: s.image_url,
                caption: s.caption || '',
                tags: tagsList,
                audience: 'everyone',
                createdAt: toIsoString(s.created_at),
                expiresAt: expIso,
                isViewed: false,
              },
              authorUsername: s.username,
              authorDisplayName: s.display_name,
              authorAvatar: s.avatar_url || '',
            });
          }
        });
      }

      return { posts, stories: taggedStories };
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'posts');
    }
  },

  getUserFollowers: async (username: string): Promise<{ users: User[] }> => {
    const profile = await getUserDocByUsername(username);
    if (!profile) throw new Error('User not found');
    try {
      const snap = await getDocs(query(collection(db, 'follows'), where('following_id', '==', profile.id)));
      const users = await Promise.all(snap.docs.map((d) => getUserDocById(d.data().follower_id)));
      return { users: users.filter((u): u is User => u !== null) };
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'follows');
    }
  },

  getUserFollowing: async (username: string): Promise<{ users: User[] }> => {
    const profile = await getUserDocByUsername(username);
    if (!profile) throw new Error('User not found');
    try {
      const snap = await getDocs(query(collection(db, 'follows'), where('follower_id', '==', profile.id)));
      const users = await Promise.all(snap.docs.map((d) => getUserDocById(d.data().following_id)));
      return { users: users.filter((u): u is User => u !== null) };
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'follows');
    }
  },

  getCachedSuggestedUsers: (): User[] | null => {
    const currentUid = auth.currentUser?.uid || '';
    if (suggestedUsersMemoryCache && suggestedUsersMemoryCache.uid === currentUid) {
      return suggestedUsersMemoryCache.users;
    }
    return null;
  },

  getSuggestedUsers: async (): Promise<{ users: User[] }> => {
    const currentUid = auth.currentUser?.uid;
    try {
      const [snap, folSnap] = await Promise.all([
        getDocs(query(collection(db, 'users'), limit(25))),
        currentUid
          ? getDocs(query(collection(db, 'follows'), where('follower_id', '==', currentUid)))
          : Promise.resolve(null),
      ]);
      const followingSet = new Set<string>();
      if (folSnap) {
        folSnap.docs.forEach((d) => followingSet.add(d.data().following_id));
      }

      const users: User[] = snap.docs
        .filter((d) => d.id !== currentUid)
        .slice(0, 12)
        .map((d) => {
          const u = d.data();
          return {
            id: u.id || d.id,
            username: u.username,
            display_name: u.display_name,
            bio: u.bio || '',
            avatar_url: u.avatar_url || '',
            is_verified: !!u.is_verified,
            is_private: !!u.is_private,
            is_following: followingSet.has(d.id),
          };
        });
      suggestedUsersMemoryCache = { uid: currentUid || '', users, ts: Date.now() };
      return { users };
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'users');
    }
  },

  followUser: async (id: string): Promise<{ status: 'following' | 'requested' }> => {
    const uid = requireUid();
    if (id === uid) throw new Error('Cannot follow yourself');
    const [target, actor] = await Promise.all([getUserDocById(id), getFastActorDoc(uid)]);
    if (!target) throw new Error('User not found');

    if (target.is_private) {
      const reqId = `${uid}__${id}`;
      try {
        await setDoc(doc(db, 'follow_requests', reqId), {
          id: reqId,
          requester_id: uid,
          target_id: id,
          status: 'pending',
          created_at: serverTimestamp(),
        });
        if (actor) {
          createNotificationDoc({
            recipientId: id,
            actor,
            type: 'follow_request',
            targetId: reqId,
          }).catch(() => {});
        }
        return { status: 'requested' };
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `follow_requests/${reqId}`);
      }
    }

    const followId = `${uid}__${id}`;
    liveFollowingUserIds.add(id);
    notifyEngagementListeners();
    try {
      await setDoc(doc(db, 'follows', followId), {
        id: followId,
        follower_id: uid,
        following_id: id,
        created_at: serverTimestamp(),
      });
      if (actor) {
        createNotificationDoc({
          recipientId: id,
          actor,
          type: 'follow',
          targetId: followId,
        }).catch(() => {});
      }
      return { status: 'following' };
    } catch (err) {
      liveFollowingUserIds.delete(id);
      notifyEngagementListeners();
      handleFirestoreError(err, OperationType.CREATE, `follows/${followId}`);
    }
  },

  unfollowUser: async (id: string): Promise<{ status: 'unfollowed' }> => {
    const uid = requireUid();
    const followId = `${uid}__${id}`;
    const reqId = `${uid}__${id}`;
    liveFollowingUserIds.delete(id);
    notifyEngagementListeners();
    try {
      await Promise.all([
        deleteDoc(doc(db, 'follows', followId)).catch(() => {}),
        deleteDoc(doc(db, 'follow_requests', reqId)).catch(() => {}),
      ]);
      return { status: 'unfollowed' };
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `follows/${followId}`);
    }
  },

  getFollowRequests: async (): Promise<{ requests: FollowRequest[] }> => {
    const uid = await getAuthenticatedUid();
    try {
      const snap = await getDocs(query(collection(db, 'follow_requests'), where('target_id', '==', uid)));
      const pending = snap.docs.filter((d) => d.data().status === 'pending');
      const requesters = await Promise.all(
        pending.map((frDoc) => getUserDocById(frDoc.data().requester_id).catch(() => null))
      );
      const requests: FollowRequest[] = [];
      pending.forEach((frDoc, idx) => {
        const data = frDoc.data();
        const requester = requesters[idx];
        if (requester) {
          requests.push({
            id: frDoc.id,
            requester_id: data.requester_id,
            created_at: toIsoString(data.created_at),
            username: requester.username,
            display_name: requester.display_name,
            avatar_url: requester.avatar_url,
            bio: requester.bio || '',
          });
        }
      });
      return { requests };
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'follow_requests');
    }
  },

  acceptFollowRequest: async (id: string): Promise<{ success: boolean }> => {
    const uid = requireUid();
    const frRef = doc(db, 'follow_requests', id);
    try {
      const frSnap = await getDoc(frRef);
      if (!frSnap.exists()) throw new Error('Request not found');
      const requesterId = frSnap.data().requester_id;
      const followId = `${requesterId}__${uid}`;

      const batch = writeBatch(db);
      batch.set(doc(db, 'follows', followId), {
        id: followId,
        follower_id: requesterId,
        following_id: uid,
        created_at: serverTimestamp(),
      });
      batch.delete(frRef);
      await batch.commit();
      return { success: true };
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `follow_requests/${id}`);
    }
  },

  rejectFollowRequest: async (id: string): Promise<{ success: boolean }> => {
    requireUid();
    try {
      await deleteDoc(doc(db, 'follow_requests', id));
      return { success: true };
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `follow_requests/${id}`);
    }
  },

  blockUser: async (id: string): Promise<{ blocked: boolean }> => {
    const uid = requireUid();
    if (id === uid) throw new Error('Cannot block self');
    const blockId = `${uid}__${id}`;
    liveBlockedUserIds.add(id);
    liveFollowingUserIds.delete(id);
    notifyEngagementListeners();
    try {
      await Promise.all([
        setDoc(doc(db, 'blocks', blockId), {
          id: blockId,
          blocker_id: uid,
          blocked_id: id,
          created_at: serverTimestamp(),
        }),
        deleteDoc(doc(db, 'follows', `${uid}__${id}`)).catch(() => {}),
      ]);
      return { blocked: true };
    } catch (err) {
      liveBlockedUserIds.delete(id);
      notifyEngagementListeners();
      handleFirestoreError(err, OperationType.CREATE, `blocks/${blockId}`);
    }
  },

  unblockUser: async (id: string): Promise<{ blocked: boolean }> => {
    const uid = requireUid();
    const blockId = `${uid}__${id}`;
    liveBlockedUserIds.delete(id);
    notifyEngagementListeners();
    try {
      await deleteDoc(doc(db, 'blocks', blockId));
      return { blocked: false };
    } catch (err) {
      liveBlockedUserIds.add(id);
      notifyEngagementListeners();
      handleFirestoreError(err, OperationType.DELETE, `blocks/${blockId}`);
    }
  },

  getBlockedUsers: async (): Promise<{ users: User[] }> => {
    const uid = await getAuthenticatedUid();
    try {
      const snap = await getDocs(query(collection(db, 'blocks'), where('blocker_id', '==', uid)));
      const users = await Promise.all(snap.docs.map((d) => getUserDocById(d.data().blocked_id)));
      return { users: users.filter((u): u is User => u !== null) };
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'blocks');
    }
  },

  // Stories & Close Friends & Highlights & Notes
  getCachedStories: (): StoryGroup[] | null => {
    return loadStoriesCache(auth.currentUser?.uid);
  },

  getStories: async (): Promise<{ storyGroups: StoryGroup[] }> => {
    const currentUid = auth.currentUser?.uid;
    try {
      const [snap, cfSnap] = await Promise.all([
        getDocs(
          query(
            collection(db, 'stories'),
            where('expires_at', '>', Timestamp.now()),
            orderBy('expires_at', 'desc'),
            limit(40)
          )
        ),
        currentUid
          ? getDocs(
              query(
                collection(db, 'close_friends_stories'),
                where('viewer_ids', 'array-contains', currentUid)
              )
            ).catch(() => null)
          : Promise.resolve(null),
      ]);

      const nowMs = Date.now();
      const viewedMap = getViewedStoriesMap(currentUid);

      const mergedRaw: Array<{ data: any; audience: 'everyone' | 'close_friends' }> = [];
      snap.docs.forEach((d) => {
        const s: any = { ...d.data(), id: d.id };
        if (new Date(toIsoString(s.expires_at)).getTime() > nowMs) {
          storyCollectionMap.set(d.id, 'stories');
          mergedRaw.push({ data: s, audience: 'everyone' });
        }
      });
      if (cfSnap) {
        cfSnap.docs.forEach((d) => {
          const s: any = { ...d.data(), id: d.id };
          if (new Date(toIsoString(s.expires_at)).getTime() > nowMs) {
            storyCollectionMap.set(d.id, 'close_friends_stories');
            mergedRaw.push({ data: s, audience: 'close_friends' });
          }
        });
      }

      mergedRaw.sort(
        (a, b) =>
          new Date(toIsoString(a.data.created_at)).getTime() -
          new Date(toIsoString(b.data.created_at)).getTime()
      );

      const userMap = new Map<string, StoryGroup>();
      for (const { data: item, audience } of mergedRaw) {
        if (!userMap.has(item.user_id)) {
          userMap.set(item.user_id, {
            userId: item.user_id,
            username: item.username,
            displayName: item.display_name,
            avatarUrl: item.avatar_url || '',
            isVerified: !!item.is_verified,
            hasUnviewed: false,
            hasCloseFriends: false,
            stories: [],
          });
        }
        const group = userMap.get(item.user_id)!;
        const isViewed = !!viewedMap[item.id];
        if (!isViewed) group.hasUnviewed = true;
        if (audience === 'close_friends') group.hasCloseFriends = true;
        group.stories.push({
          id: item.id,
          imageUrl: item.image_url,
          caption: item.caption || '',
          tags: Array.isArray(item.tags) ? item.tags : [],
          audience,
          createdAt: toIsoString(item.created_at),
          expiresAt: toIsoString(item.expires_at),
          isViewed,
        });
      }

      // Instagram-style ordering: current user first, then unviewed stories, then most recent
      const storyGroups = Array.from(userMap.values()).sort((a, b) => {
        if (currentUid) {
          if (a.userId === currentUid && b.userId !== currentUid) return -1;
          if (b.userId === currentUid && a.userId !== currentUid) return 1;
        }
        if (a.hasUnviewed !== b.hasUnviewed) return a.hasUnviewed ? -1 : 1;
        const aLatest = new Date(a.stories[a.stories.length - 1]?.createdAt || 0).getTime();
        const bLatest = new Date(b.stories[b.stories.length - 1]?.createdAt || 0).getTime();
        return bLatest - aLatest;
      });

      saveStoriesCache(storyGroups);
      return { storyGroups };
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'stories');
    }
  },

  syncStoryViewsBackground: async (storyIds: string[]): Promise<Set<string>> => {
    const currentUid = auth.currentUser?.uid;
    const newlyViewed = new Set<string>();
    if (!currentUid || storyIds.length === 0) return newlyViewed;
    const localMap = getViewedStoriesMap(currentUid);
    const unchecked = storyIds.filter((id) => !localMap[id]).slice(0, 20);
    if (unchecked.length === 0) return newlyViewed;

    await Promise.all(
      unchecked.map(async (sid) => {
        const colName = storyCollectionMap.get(sid) || 'stories';
        try {
          const vSnap = await getDoc(doc(db, colName, sid, 'views', currentUid));
          if (vSnap.exists()) {
            newlyViewed.add(sid);
            markStoryViewedLocally(currentUid, sid);
          }
        } catch {}
      })
    );
    return newlyViewed;
  },

  getStoryViewsCount: async (storyId: string, audience?: 'everyone' | 'close_friends'): Promise<number> => {
    if (!auth.currentUser?.uid || !storyId) return 0;
    const colName = audience === 'close_friends' ? 'close_friends_stories' : storyCollectionMap.get(storyId) || 'stories';
    try {
      const snap = await getDocs(collection(db, colName, storyId, 'views'));
      return snap.size;
    } catch {
      return 0;
    }
  },

  getStoryViewers: async (storyId: string, audience?: 'everyone' | 'close_friends'): Promise<{ viewers: StoryViewer[] }> => {
    if (!auth.currentUser?.uid || !storyId) return { viewers: [] };
    const colName = audience === 'close_friends' ? 'close_friends_stories' : storyCollectionMap.get(storyId) || 'stories';
    try {
      const snap = await getDocs(collection(db, colName, storyId, 'views'));
      const rows = await Promise.all(
        snap.docs.map(async (vDoc) => {
          const d = vDoc.data();
          const u = await getUserDocById(d.user_id || vDoc.id).catch(() => null);
          if (!u) return null;
          return {
            user: u,
            viewed_at: toIsoString(d.created_at),
          };
        })
      );
      const viewers = rows
        .filter((r): r is StoryViewer => r !== null)
        .sort((a, b) => new Date(b.viewed_at).getTime() - new Date(a.viewed_at).getTime());
      return { viewers };
    } catch {
      return { viewers: [] };
    }
  },

  createStory: async (
    imageUrl: string,
    caption?: string,
    tags?: string[],
    audience: 'everyone' | 'close_friends' = 'everyone'
  ): Promise<{ id: string; success: boolean }> => {
    const uid = requireUid();
    if (!imageUrl) throw new Error('Image required for story');
    const author = await getFastActorDoc(uid);
    if (!author) throw new Error('Profile not found');

    const compressedImg = imageUrl.startsWith('data:image/')
      ? await compressDataUrl(imageUrl, 960, 210000)
      : imageUrl;

    const cleanTags = Array.from(
      new Set(
        (tags || [])
          .map((t) => t.trim().slice(0, 40))
          .filter((t) => t.length >= 2)
      )
    ).slice(0, 10);

    const storyId = genId('sty');
    const expiresAt = Timestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000));
    const colName = audience === 'close_friends' ? 'close_friends_stories' : 'stories';

    try {
      if (audience === 'close_friends') {
        const cfSnap = await getDocs(
          query(collection(db, 'users', uid, 'close_friends'), where('user_id', '==', uid))
        ).catch(() => null);
        const friendIds = cfSnap ? cfSnap.docs.map((d) => d.data().friend_id).filter(Boolean) : [];
        const viewerIds = Array.from(new Set([uid, ...friendIds])).slice(0, 100);
        await setDoc(doc(db, 'close_friends_stories', storyId), {
          id: storyId,
          user_id: uid,
          username: author.username,
          display_name: author.display_name,
          avatar_url: author.avatar_url || '',
          is_verified: false,
          image_url: compressedImg.slice(0, 450000),
          caption: (caption || '').trim().slice(0, 120),
          tags: cleanTags,
          viewer_ids: viewerIds,
          expires_at: expiresAt,
          created_at: serverTimestamp(),
        });
      } else {
        await setDoc(doc(db, 'stories', storyId), {
          id: storyId,
          user_id: uid,
          username: author.username,
          display_name: author.display_name,
          avatar_url: author.avatar_url || '',
          is_verified: false,
          image_url: compressedImg.slice(0, 450000),
          caption: (caption || '').trim().slice(0, 120),
          tags: cleanTags,
          expires_at: expiresAt,
          created_at: serverTimestamp(),
        });
      }
      storyCollectionMap.set(storyId, colName);
      invalidateStoriesCache();

      // Background notifications for @username story tags & Sync Points reward
      const mentionUsernames = cleanTags
        .filter((t) => t.startsWith('@'))
        .map((t) => t.slice(1).toLowerCase())
        .filter((u) => u && u !== author.username.toLowerCase());

      if (mentionUsernames.length > 0) {
        Promise.all(
          mentionUsernames.slice(0, 5).map(async (uname) => {
            const target = await getUserDocByUsername(uname).catch(() => null);
            if (target && target.id !== uid) {
              await createNotificationDoc({
                recipientId: target.id,
                actor: author,
                type: 'story_tag',
                targetId: storyId,
              });
            }
          })
        ).catch(() => {});
      }
      awardSyncPointsInternal(uid, 'story').catch(() => {});
      return { id: storyId, success: true };
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `${colName}/${storyId}`);
    }
  },

  replyToStory: async (recipientId: string, storyPreviewCaption: string, replyText: string): Promise<string> => {
    const uid = requireUid();
    const { conversationId } = await api.createConversation(recipientId);
    const prefix = storyPreviewCaption
      ? `Replied to your story ("${storyPreviewCaption.slice(0, 40)}"):\n`
      : 'Replied to your story:\n';
    await api.sendMessage(conversationId, `${prefix}${replyText.trim()}`, null, recipientId);
    awardSyncPointsInternal(uid, 'comment').catch(() => {});
    return conversationId;
  },

  viewStory: async (
    id: string,
    expiresAtIso?: string,
    audience?: 'everyone' | 'close_friends'
  ): Promise<{ viewed: boolean }> => {
    const uid = auth.currentUser?.uid;
    if (!uid) return { viewed: false };
    markStoryViewedLocally(uid, id, expiresAtIso);
    const colName = audience === 'close_friends' ? 'close_friends_stories' : storyCollectionMap.get(id) || 'stories';
    const path = `${colName}/${id}/views/${uid}`;
    try {
      const ref = doc(db, colName, id, 'views', uid);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        await setDoc(ref, {
          story_id: id,
          user_id: uid,
          created_at: serverTimestamp(),
        });
      }
      return { viewed: true };
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  },

  deleteStory: async (id: string, audience?: 'everyone' | 'close_friends'): Promise<{ success: boolean }> => {
    requireUid();
    const colName = audience === 'close_friends' ? 'close_friends_stories' : storyCollectionMap.get(id) || 'stories';
    try {
      await deleteDoc(doc(db, colName, id));
      storyCollectionMap.delete(id);
      invalidateStoriesCache();
      return { success: true };
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `${colName}/${id}`);
    }
  },

  // Close Friends
  getCloseFriends: async (): Promise<{ ids: string[]; users: User[] }> => {
    const uid = await getAuthenticatedUid();
    try {
      const snap = await getDocs(query(collection(db, 'users', uid, 'close_friends'), where('user_id', '==', uid)));
      const ids = snap.docs.map((d) => d.data().friend_id || d.id).filter(Boolean);
      const userDocs = await Promise.all(ids.map((fid) => getUserDocById(fid).catch(() => null)));
      return {
        ids,
        users: userDocs.filter((u): u is User => u !== null),
      };
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, `users/${uid}/close_friends`);
    }
  },

  isUserCloseFriend: async (friendId: string): Promise<boolean> => {
    const uid = auth.currentUser?.uid;
    if (!uid || !friendId || uid === friendId) return false;
    try {
      const snap = await getDoc(doc(db, 'users', uid, 'close_friends', friendId));
      return snap.exists();
    } catch {
      return false;
    }
  },

  addCloseFriend: async (friendId: string): Promise<{ added: boolean }> => {
    const uid = requireUid();
    if (!friendId || friendId === uid) throw new Error('Invalid user');
    const path = `users/${uid}/close_friends/${friendId}`;
    try {
      await setDoc(doc(db, 'users', uid, 'close_friends', friendId), {
        user_id: uid,
        friend_id: friendId,
        created_at: serverTimestamp(),
      });
      return { added: true };
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    }
  },

  removeCloseFriend: async (friendId: string): Promise<{ removed: boolean }> => {
    const uid = requireUid();
    const path = `users/${uid}/close_friends/${friendId}`;
    try {
      await deleteDoc(doc(db, 'users', uid, 'close_friends', friendId));
      return { removed: true };
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  },

  // Story Highlights
  getUserHighlights: async (userId: string): Promise<{ highlights: StoryHighlight[] }> => {
    try {
      const snap = await getDocs(query(collection(db, 'story_highlights'), where('user_id', '==', userId)));
      const highlights: StoryHighlight[] = await Promise.all(
        snap.docs.map(async (hDoc) => {
          const d = hDoc.data();
          const itemsSnap = await getDocs(collection(db, 'story_highlights', hDoc.id, 'items')).catch(() => null);
          const items: StoryHighlightItem[] = itemsSnap
            ? itemsSnap.docs
                .map((iDoc) => {
                  const idata = iDoc.data();
                  return {
                    id: iDoc.id,
                    highlight_id: hDoc.id,
                    user_id: idata.user_id,
                    image_url: idata.image_url,
                    caption: idata.caption || '',
                    tags: Array.isArray(idata.tags) ? idata.tags : [],
                    created_at: toIsoString(idata.created_at),
                  };
                })
                .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
            : [];
          return {
            id: hDoc.id,
            user_id: d.user_id,
            title: d.title,
            cover_url: d.cover_url,
            created_at: toIsoString(d.created_at),
            updated_at: toIsoString(d.updated_at),
            items,
          };
        })
      );
      highlights.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
      return { highlights };
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'story_highlights');
    }
  },

  createHighlight: async (
    title: string,
    coverUrl: string,
    firstItem: { imageUrl: string; caption?: string; tags?: string[] }
  ): Promise<{ highlight: StoryHighlight }> => {
    const uid = requireUid();
    const safeTitle = title.trim().slice(0, 32) || 'Highlights';
    const compressedCover = await api.uploadImage(coverUrl);
    const compressedItemImg =
      firstItem.imageUrl === coverUrl ? compressedCover : await api.uploadImage(firstItem.imageUrl);
    const highlightId = genId('hlt');
    const itemId = genId('hitem');
    const hRef = doc(db, 'story_highlights', highlightId);
    const iRef = doc(db, 'story_highlights', highlightId, 'items', itemId);

    try {
      await setDoc(hRef, {
        id: highlightId,
        user_id: uid,
        title: safeTitle,
        cover_url: compressedCover.url.slice(0, 450000),
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      });
      await setDoc(iRef, {
        id: itemId,
        highlight_id: highlightId,
        user_id: uid,
        image_url: compressedItemImg.url.slice(0, 450000),
        caption: (firstItem.caption || '').trim().slice(0, 120),
        tags: (firstItem.tags || []).slice(0, 10),
        created_at: serverTimestamp(),
      });
      const nowIso = new Date().toISOString();
      return {
        highlight: {
          id: highlightId,
          user_id: uid,
          title: safeTitle,
          cover_url: compressedCover.url.slice(0, 450000),
          created_at: nowIso,
          updated_at: nowIso,
          items: [
            {
              id: itemId,
              highlight_id: highlightId,
              user_id: uid,
              image_url: compressedItemImg.url.slice(0, 450000),
              caption: (firstItem.caption || '').trim().slice(0, 120),
              tags: (firstItem.tags || []).slice(0, 10),
              created_at: nowIso,
            },
          ],
        },
      };
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `story_highlights/${highlightId}`);
    }
  },

  addStoryToHighlight: async (
    highlightId: string,
    item: { imageUrl: string; caption?: string; tags?: string[] }
  ): Promise<{ item: StoryHighlightItem }> => {
    const uid = requireUid();
    const compressedImg = await api.uploadImage(item.imageUrl);
    const itemId = genId('hitem');
    const safeCaption = (item.caption || '').trim().slice(0, 120);
    const safeTags = (item.tags || []).slice(0, 10);

    try {
      const hRef = doc(db, 'story_highlights', highlightId);
      const hSnap = await getDoc(hRef);
      if (!hSnap.exists()) throw new Error('Highlight not found');
      const hData = hSnap.data();

      await setDoc(doc(db, 'story_highlights', highlightId, 'items', itemId), {
        id: itemId,
        highlight_id: highlightId,
        user_id: uid,
        image_url: compressedImg.url.slice(0, 450000),
        caption: safeCaption,
        tags: safeTags,
        created_at: serverTimestamp(),
      });
      await updateDoc(hRef, {
        title: hData.title,
        cover_url: hData.cover_url,
        updated_at: serverTimestamp(),
      });
      return {
        item: {
          id: itemId,
          highlight_id: highlightId,
          user_id: uid,
          image_url: compressedImg.url.slice(0, 450000),
          caption: safeCaption,
          tags: safeTags,
          created_at: new Date().toISOString(),
        },
      };
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `story_highlights/${highlightId}/items/${itemId}`);
    }
  },

  deleteHighlight: async (highlightId: string): Promise<{ success: boolean }> => {
    requireUid();
    try {
      const itemsSnap = await getDocs(collection(db, 'story_highlights', highlightId, 'items')).catch(() => null);
      if (itemsSnap) {
        await Promise.all(itemsSnap.docs.map((d) => deleteDoc(d.ref).catch(() => {})));
      }
      await deleteDoc(doc(db, 'story_highlights', highlightId));
      return { success: true };
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `story_highlights/${highlightId}`);
    }
  },

  // Instagram-style 24h Notes
  getNotes: async (): Promise<{ notes: Note[] }> => {
    if (!auth.currentUser?.uid) return { notes: [] };
    try {
      const snap = await getDocs(
        query(
          collection(db, 'notes'),
          where('expires_at', '>', Timestamp.now()),
          orderBy('expires_at', 'desc'),
          limit(40)
        )
      );
      const nowMs = Date.now();
      const notes: Note[] = snap.docs
        .map((d) => {
          const data = d.data();
          return {
            user_id: data.user_id || d.id,
            username: data.username,
            display_name: data.display_name,
            avatar_url: data.avatar_url || '',
            is_verified: !!data.is_verified,
            text: data.text,
            expires_at: toIsoString(data.expires_at),
            created_at: toIsoString(data.created_at),
            updated_at: toIsoString(data.updated_at),
          };
        })
        .filter((n) => new Date(n.expires_at).getTime() > nowMs)
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
      return { notes };
    } catch {
      return { notes: [] };
    }
  },

  setNote: async (text: string): Promise<{ note: Note }> => {
    const uid = requireUid();
    const safeText = text.trim().slice(0, 60);
    if (!safeText) throw new Error('Note text cannot be empty');
    const actor = await getFastActorDoc(uid);
    if (!actor) throw new Error('Profile not found');

    const noteRef = doc(db, 'notes', uid);
    const expiresAt = Timestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000));
    try {
      const existingSnap = await getDoc(noteRef).catch(() => null);
      if (existingSnap && existingSnap.exists()) {
        await updateDoc(noteRef, {
          username: actor.username,
          display_name: actor.display_name,
          avatar_url: actor.avatar_url || '',
          is_verified: !!actor.is_verified,
          text: safeText,
          expires_at: expiresAt,
          updated_at: serverTimestamp(),
        });
      } else {
        await setDoc(noteRef, {
          user_id: uid,
          username: actor.username,
          display_name: actor.display_name,
          avatar_url: actor.avatar_url || '',
          is_verified: !!actor.is_verified,
          text: safeText,
          expires_at: expiresAt,
          created_at: serverTimestamp(),
          updated_at: serverTimestamp(),
        });
      }
      const nowIso = new Date().toISOString();
      return {
        note: {
          user_id: uid,
          username: actor.username,
          display_name: actor.display_name,
          avatar_url: actor.avatar_url || '',
          is_verified: !!actor.is_verified,
          text: safeText,
          expires_at: expiresAt.toDate().toISOString(),
          created_at: nowIso,
          updated_at: nowIso,
        },
      };
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `notes/${uid}`);
    }
  },

  deleteNote: async (): Promise<{ success: boolean }> => {
    const uid = requireUid();
    try {
      await deleteDoc(doc(db, 'notes', uid));
      return { success: true };
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `notes/${uid}`);
    }
  },

  // Messaging
  getCachedConversations: (): Conversation[] | null => {
    const uid = auth.currentUser?.uid || getCachedMe()?.id;
    if (!uid || !conversationsMemoryCache || conversationsMemoryCache.uid !== uid) return null;
    return conversationsMemoryCache.items;
  },

  getConversations: async (): Promise<{ conversations: Conversation[] }> => {
    const uid = await getAuthenticatedUid();
    try {
      const snap = await getDocs(
        query(collection(db, 'conversations'), where('member_ids', 'array-contains', uid))
      );
      const sortedDocs = snap.docs.sort(
        (a, b) => new Date(toIsoString(b.data().updated_at)).getTime() - new Date(toIsoString(a.data().updated_at)).getTime()
      );

      const metaList = sortedDocs
        .map((cDoc) => {
          const d = cDoc.data();
          const otherId = (d.member_ids || []).find((m: string) => m !== uid);
          return otherId ? { cDoc, d, otherId } : null;
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      const uniqueOtherIds: string[] = Array.from(new Set(metaList.map((m) => m.otherId)));
      const userMap = new Map<string, User>();
      await Promise.all(
        uniqueOtherIds.map(async (otherId) => {
          const u = await getUserDocById(otherId).catch(() => null);
          if (u) userMap.set(otherId, u);
        })
      );

      const readSnaps = await Promise.all(
        metaList.map(({ cDoc, d }) =>
          d.last_message_sender && d.last_message_sender !== uid && d.last_message_time
            ? getDoc(doc(db, 'conversations', cDoc.id, 'reads', uid)).catch(() => null)
            : Promise.resolve(null)
        )
      );

      const conversations: Conversation[] = [];
      metaList.forEach(({ cDoc, d, otherId }, idx) => {
        const otherUser = userMap.get(otherId);
        if (!otherUser) return;

        let unreadCount = 0;
        const readSnap = readSnaps[idx];
        if (d.last_message_sender && d.last_message_sender !== uid && d.last_message_time) {
          const lastRead = readSnap && readSnap.exists() ? toIsoString(readSnap.data().last_read_at) : '';
          const msgTime = toIsoString(d.last_message_time);
          if (!lastRead || new Date(msgTime).getTime() > new Date(lastRead).getTime()) {
            unreadCount = 1;
          }
        }

        conversations.push({
          id: cDoc.id,
          updated_at: toIsoString(d.updated_at),
          other_id: otherUser.id,
          username: otherUser.username,
          display_name: otherUser.display_name,
          avatar_url: otherUser.avatar_url,
          is_verified: !!otherUser.is_verified,
          last_message_content: d.last_message_content || '',
          last_message_time: d.last_message_time ? toIsoString(d.last_message_time) : undefined,
          last_message_sender: d.last_message_sender || undefined,
          unread_count: unreadCount,
        });
      });

      conversationsMemoryCache = { uid, items: conversations, ts: Date.now() };
      return { conversations };
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'conversations');
    }
  },

  createConversation: async (participantId: string): Promise<{ conversationId: string }> => {
    const uid = requireUid();
    if (!participantId || participantId === uid) throw new Error('Invalid participant');
    const members = [uid, participantId].sort();
    const convId = `${members[0]}__${members[1]}`;

    try {
      const existingSnap = await getDocs(
        query(collection(db, 'conversations'), where('member_ids', 'array-contains', uid))
      );
      const found = existingSnap.docs.find((d) => d.id === convId);
      if (found) return { conversationId: convId };

      await setDoc(doc(db, 'conversations', convId), {
        id: convId,
        member_ids: members,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      });
      return { conversationId: convId };
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `conversations/${convId}`);
    }
  },

  getConversationOtherUser: async (convId: string): Promise<User> => {
    const uid = requireUid();
    const convSnap = await getDoc(doc(db, 'conversations', convId));
    if (!convSnap.exists()) throw new Error('Conversation not found');
    const members: string[] = convSnap.data().member_ids || [];
    const otherId = members.find((m) => m !== uid) || uid;
    return (
      (await getUserDocById(otherId)) || {
        id: otherId,
        username: 'member',
        display_name: 'Member',
        bio: '',
        avatar_url: '',
        is_verified: false,
        is_private: false,
      }
    );
  },

  markConversationRead: async (convId: string): Promise<void> => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    try {
      await setDoc(doc(db, 'conversations', convId, 'reads', uid), {
        user_id: uid,
        last_read_at: serverTimestamp(),
      });
    } catch {}
  },

  subscribeConversationMessages: (
    convId: string,
    onUpdate: (messages: Message[]) => void,
    onError?: (err: unknown) => void
  ): (() => void) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return () => {};
    const q = query(
      collection(db, 'conversations', convId, 'messages'),
      where('member_ids', 'array-contains', uid)
    );
    return onSnapshot(
      q,
      (snap) => {
        const messages: Message[] = snap.docs
          .map((m) => {
            const d = m.data();
            return {
              id: m.id,
              conversation_id: d.conversation_id,
              sender_id: d.sender_id,
              content: d.content || '',
              image_url: d.image_url || null,
              reply_to_id: d.reply_to_id || null,
              reply_to_text: d.reply_to_text || null,
              reply_to_sender: d.reply_to_sender || null,
              shared_post_id: d.shared_post_id || null,
              shared_post_author: d.shared_post_author || null,
              shared_post_username: d.shared_post_username || null,
              shared_post_text: d.shared_post_text || null,
              shared_post_image: d.shared_post_image || null,
              created_at: toIsoString(d.created_at),
            };
          })
          .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        onUpdate(messages);
      },
      (err) => {
        if (onError) onError(err);
      }
    );
  },

  subscribeConversationReactions: (
    convId: string,
    onUpdate: (reactions: MessageReaction[]) => void
  ): (() => void) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return () => {};
    const q = query(
      collection(db, 'conversations', convId, 'message_reactions'),
      where('member_ids', 'array-contains', uid)
    );
    return onSnapshot(
      q,
      (snap) => {
        const list: MessageReaction[] = snap.docs.map((rDoc) => {
          const d = rDoc.data();
          return {
            id: rDoc.id,
            message_id: d.message_id,
            user_id: d.user_id,
            emoji: d.emoji,
          };
        });
        onUpdate(list);
      },
      () => {}
    );
  },

  reactToMessage: async (
    convId: string,
    messageId: string,
    emoji: string,
    knownMemberIds?: string[]
  ): Promise<void> => {
    const uid = requireUid();
    const safeEmoji = emoji.trim().slice(0, 16);
    if (!safeEmoji) return;
    const reactionId = `${messageId}__${uid}`;
    const ref = doc(db, 'conversations', convId, 'message_reactions', reactionId);

    try {
      const existingSnap = await getDoc(ref).catch(() => null);
      if (existingSnap && existingSnap.exists()) {
        const curEmoji = existingSnap.data().emoji;
        if (curEmoji === safeEmoji) {
          await deleteDoc(ref);
        } else {
          await updateDoc(ref, {
            emoji: safeEmoji,
            updated_at: serverTimestamp(),
          });
        }
        return;
      }

      let memberIds = knownMemberIds;
      if (!memberIds || memberIds.length !== 2) {
        const convSnap = await getDoc(doc(db, 'conversations', convId));
        if (!convSnap.exists()) throw new Error('Conversation not found');
        memberIds = convSnap.data().member_ids || [];
      }

      await setDoc(ref, {
        id: reactionId,
        message_id: messageId,
        user_id: uid,
        member_ids: memberIds,
        emoji: safeEmoji,
        updated_at: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `conversations/${convId}/message_reactions/${reactionId}`);
    }
  },

  unsendMessage: async (convId: string, messageId: string, fallbackPreview?: string): Promise<void> => {
    requireUid();
    const msgRef = doc(db, 'conversations', convId, 'messages', messageId);
    const convRef = doc(db, 'conversations', convId);
    try {
      await deleteDoc(msgRef);
      await updateDoc(convRef, {
        last_message_content: (fallbackPreview || 'Message unsent').slice(0, 1000),
        updated_at: serverTimestamp(),
      }).catch(() => {});
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `conversations/${convId}/messages/${messageId}`);
    }
  },

  setConversationTyping: async (convId: string, isTyping: boolean): Promise<void> => {
    const uid = auth.currentUser?.uid;
    if (!uid || !convId) return;
    const typingRef = doc(db, 'conversations', convId, 'typing', uid);
    try {
      const existing = await getDoc(typingRef).catch(() => null);
      if (existing && existing.exists()) {
        await updateDoc(typingRef, {
          is_typing: isTyping,
          updated_at: serverTimestamp(),
        });
      } else if (isTyping) {
        await setDoc(typingRef, {
          user_id: uid,
          is_typing: true,
          updated_at: serverTimestamp(),
        });
      }
    } catch {}
  },

  subscribeConversationTyping: (
    convId: string,
    otherUserId: string,
    onChange: (isTyping: boolean) => void
  ): (() => void) => {
    if (!convId || !otherUserId) {
      onChange(false);
      return () => {};
    }
    return onSnapshot(
      doc(db, 'conversations', convId, 'typing', otherUserId),
      (snap) => {
        if (!snap.exists()) {
          onChange(false);
          return;
        }
        const d = snap.data();
        const updatedMs = d.updated_at ? new Date(toIsoString(d.updated_at)).getTime() : 0;
        const fresh = Date.now() - updatedMs < 10_000;
        onChange(!!d.is_typing && fresh);
      },
      () => onChange(false)
    );
  },

  subscribeConversationRead: (
    convId: string,
    otherUserId: string,
    onChange: (lastReadAtIso: string | null) => void
  ): (() => void) => {
    if (!convId || !otherUserId) {
      onChange(null);
      return () => {};
    }
    return onSnapshot(
      doc(db, 'conversations', convId, 'reads', otherUserId),
      (snap) => {
        if (!snap.exists()) {
          onChange(null);
          return;
        }
        const d = snap.data();
        onChange(d.last_read_at ? toIsoString(d.last_read_at) : null);
      },
      () => onChange(null)
    );
  },

  getConversationMessages: async (id: string): Promise<{ messages: Message[]; otherUser: User }> => {
    const uid = requireUid();
    try {
      const [otherUser, msgSnap] = await Promise.all([
        api.getConversationOtherUser(id),
        getDocs(query(collection(db, 'conversations', id, 'messages'), where('member_ids', 'array-contains', uid))),
      ]);

      api.markConversationRead(id);

      const messages: Message[] = msgSnap.docs
        .map((m) => {
          const d = m.data();
          return {
            id: m.id,
            conversation_id: d.conversation_id,
            sender_id: d.sender_id,
            content: d.content || '',
            image_url: d.image_url || null,
            reply_to_id: d.reply_to_id || null,
            reply_to_text: d.reply_to_text || null,
            reply_to_sender: d.reply_to_sender || null,
            shared_post_id: d.shared_post_id || null,
            shared_post_author: d.shared_post_author || null,
            shared_post_username: d.shared_post_username || null,
            shared_post_text: d.shared_post_text || null,
            shared_post_image: d.shared_post_image || null,
            created_at: toIsoString(d.created_at),
          };
        })
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

      return { messages, otherUser };
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, `conversations/${id}/messages`);
    }
  },

  sendMessage: async (
    convId: string,
    content: string,
    imageUrl?: string | null,
    knownOtherId?: string,
    options?: {
      replyTo?: { id: string; text: string; sender: string } | null;
      sharedPost?: {
        id: string;
        username: string;
        display_name: string;
        content: string;
        images?: string[];
      } | null;
    }
  ): Promise<{ message: Message }> => {
    const uid = requireUid();
    const safeContent = (content || '').trim().slice(0, 2000);
    const safeImg = imageUrl ? imageUrl.slice(0, 450000) : null;
    const replyTo = options?.replyTo || null;
    const sharedPost = options?.sharedPost || null;
    if (!safeContent && !safeImg && !sharedPost) throw new Error('Message cannot be empty');

    const convRef = doc(db, 'conversations', convId);
    try {
      let memberIds: string[];
      let otherId = knownOtherId;
      if (knownOtherId) {
        memberIds = [uid, knownOtherId].sort();
      } else {
        const convSnap = await getDoc(convRef);
        if (!convSnap.exists()) throw new Error('Conversation not found');
        memberIds = convSnap.data().member_ids || [];
        otherId = memberIds.find((m) => m !== uid);
      }

      const msgId = genId('msg');
      const msgPayload: Record<string, any> = {
        id: msgId,
        conversation_id: convId,
        sender_id: uid,
        member_ids: memberIds,
        content: safeContent,
        image_url: safeImg,
        created_at: serverTimestamp(),
      };
      if (replyTo) {
        msgPayload.reply_to_id = replyTo.id.slice(0, 128);
        msgPayload.reply_to_text = replyTo.text.slice(0, 300);
        msgPayload.reply_to_sender = replyTo.sender.slice(0, 80);
      }
      if (sharedPost) {
        msgPayload.shared_post_id = sharedPost.id.slice(0, 128);
        msgPayload.shared_post_author = (sharedPost.display_name || sharedPost.username).slice(0, 80);
        msgPayload.shared_post_username = (sharedPost.username || 'member').slice(0, 20);
        msgPayload.shared_post_text = (sharedPost.content || '').slice(0, 300);
        msgPayload.shared_post_image = sharedPost.images?.[0] ? sharedPost.images[0].slice(0, 450000) : null;
      }

      const previewSummary =
        safeContent ||
        (sharedPost ? `Shared a post by @${sharedPost.username}` : 'Sent an image');

      const batch = writeBatch(db);
      batch.set(doc(db, 'conversations', convId, 'messages', msgId), msgPayload);
      batch.update(convRef, {
        last_message_content: previewSummary.slice(0, 1000),
        last_message_sender: uid,
        last_message_time: serverTimestamp(),
        updated_at: serverTimestamp(),
      });
      batch.set(doc(db, 'conversations', convId, 'reads', uid), {
        user_id: uid,
        last_read_at: serverTimestamp(),
      });
      await batch.commit();

      if (otherId) {
        getFastActorDoc(uid)
          .then((actor) => {
            if (!actor) return;
            return createNotificationDoc({
              recipientId: otherId!,
              actor,
              type: 'message',
              targetId: convId,
            });
          })
          .catch(() => {});
      }

      return {
        message: {
          id: msgId,
          conversation_id: convId,
          sender_id: uid,
          content: safeContent,
          image_url: safeImg,
          reply_to_id: msgPayload.reply_to_id || null,
          reply_to_text: msgPayload.reply_to_text || null,
          reply_to_sender: msgPayload.reply_to_sender || null,
          shared_post_id: msgPayload.shared_post_id || null,
          shared_post_author: msgPayload.shared_post_author || null,
          shared_post_username: msgPayload.shared_post_username || null,
          shared_post_text: msgPayload.shared_post_text || null,
          shared_post_image: msgPayload.shared_post_image || null,
          created_at: new Date().toISOString(),
        },
      };
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `conversations/${convId}/messages`);
    }
  },

  // Notifications
  getCachedNotifications: (): NotificationItem[] | null => {
    const uid = auth.currentUser?.uid || getCachedMe()?.id;
    if (!uid || !notificationsMemoryCache || notificationsMemoryCache.uid !== uid) return null;
    return notificationsMemoryCache.items;
  },

  getNotifications: async (): Promise<{ notifications: NotificationItem[] }> => {
    const uid = await getAuthenticatedUid();
    try {
      const snap = await getDocs(query(collection(db, 'notifications'), where('user_id', '==', uid)));
      const notifications: NotificationItem[] = snap.docs
        .map((d) => {
          const n = d.data();
          return {
            id: d.id,
            user_id: n.user_id,
            actor_id: n.actor_id,
            type: n.type,
            target_id: n.target_id || '',
            read: n.read ? 1 : 0,
            created_at: toIsoString(n.created_at),
            actor_username: n.actor_username,
            actor_display_name: n.actor_display_name,
            actor_avatar_url: n.actor_avatar_url || '',
            actor_verified: n.actor_verified ? 1 : 0,
          };
        })
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 50);
      notificationsMemoryCache = { uid, items: notifications, ts: Date.now() };
      return { notifications };
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'notifications');
    }
  },

  markAllNotificationsRead: async (): Promise<{ success: boolean }> => {
    const uid = requireUid();
    try {
      const snap = await getDocs(query(collection(db, 'notifications'), where('user_id', '==', uid)));
      const unread = snap.docs.filter((d) => !d.data().read);
      if (unread.length > 0) {
        const batch = writeBatch(db);
        unread.forEach((d) => batch.update(d.ref, { read: true }));
        await batch.commit();
      }
      if (notificationsMemoryCache && notificationsMemoryCache.uid === uid) {
        notificationsMemoryCache.items = notificationsMemoryCache.items.map((n) => ({ ...n, read: 1 }));
      }
      return { success: true };
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'notifications');
    }
  },

  markNotificationRead: async (id: string): Promise<{ success: boolean }> => {
    requireUid();
    try {
      await updateDoc(doc(db, 'notifications', id), { read: true });
      return { success: true };
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `notifications/${id}`);
    }
  },

  clearAllNotifications: async (): Promise<{ success: boolean }> => {
    const uid = requireUid();
    try {
      const snap = await getDocs(query(collection(db, 'notifications'), where('user_id', '==', uid)));
      const docs = snap.docs;
      for (let i = 0; i < docs.length; i += 450) {
        const chunk = docs.slice(i, i + 450);
        const batch = writeBatch(db);
        chunk.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
      notificationsMemoryCache = { uid, items: [], ts: Date.now() };
      return { success: true };
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'notifications');
    }
  },

  // Search
  search: async (
    qText: string
  ): Promise<{ users: User[]; posts: Post[]; hashtags: { tag: string; count: number }[] }> => {
    const clean = qText.trim().toLowerCase().replace('#', '');
    if (!clean) {
      return {
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
      };
    }

    try {
      const [usersSnap, postsSnap] = await Promise.all([
        getDocs(query(collection(db, 'users'), limit(50))),
        getDocs(query(collection(db, 'posts'), orderBy('created_at', 'desc'), limit(60))),
      ]);

      const users: User[] = usersSnap.docs
        .map((d) => d.data())
        .filter(
          (u) =>
            (u.username || '').toLowerCase().includes(clean) ||
            (u.display_name || '').toLowerCase().includes(clean)
        )
        .slice(0, 10)
        .map((u) => ({
          id: u.id,
          username: u.username,
          display_name: u.display_name,
          bio: u.bio || '',
          avatar_url: u.avatar_url || '',
          is_verified: !!u.is_verified,
          is_private: !!u.is_private,
        }));

      const matchedRawPosts = postsSnap.docs
        .map((d) => ({ ...d.data(), id: d.id }))
        .filter((p: any) => (p.content || '').toLowerCase().includes(clean))
        .slice(0, 20);

      const posts = await hydratePosts(matchedRawPosts, auth.currentUser?.uid);
      return { users, posts, hashtags: [] };
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'posts');
    }
  },

  // Moderation
  report: async (payload: {
    target_type: 'post' | 'user' | 'comment';
    target_id: string;
    reason: string;
    details?: string;
  }): Promise<{ success: boolean; message: string }> => {
    const uid = requireUid();
    const reportId = genId('rep');
    try {
      await setDoc(doc(db, 'reports', reportId), {
        id: reportId,
        reporter_id: uid,
        target_type: payload.target_type,
        target_id: payload.target_id.slice(0, 256),
        reason: payload.reason.slice(0, 200),
        details: (payload.details || '').slice(0, 1000),
        status: 'pending',
        created_at: serverTimestamp(),
      });
      return { success: true, message: 'Report submitted successfully.' };
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `reports/${reportId}`);
    }
  },

  // Account Password Security (stored hashed in owner-only private vault)
  getPrivateSecurityInfo: async (forceServer = false): Promise<{ hasPassword: boolean }> => {
    const uid = requireUid();
    const infoRef = doc(db, 'users', uid, 'private', 'info');
    try {
      const snap = forceServer
        ? await getDocFromServer(infoRef).catch(() => getDoc(infoRef))
        : await getDoc(infoRef);
      if (!snap.exists()) {
        saveCachedHasPassword(uid, false);
        return { hasPassword: false };
      }
      const d = snap.data();
      const hasPassword = !!(d.has_password && d.password_hash && d.password_salt);
      saveCachedHasPassword(uid, hasPassword);
      return { hasPassword };
    } catch {
      return { hasPassword: getCachedHasPassword(uid) };
    }
  },

  setAccountPassword: async (password: string): Promise<{ success: boolean }> => {
    const uid = requireUid();
    const email = (auth.currentUser?.email || `${uid}@users.sync`).slice(0, 200);
    const infoRef = doc(db, 'users', uid, 'private', 'info');
    const path = `users/${uid}/private/info`;
    const salt = generateSalt(16);
    const hash = await hashPassword(password, salt);

    let exists = false;
    try {
      const snap = await getDoc(infoRef);
      exists = snap.exists();
    } catch {}

    if (exists) {
      try {
        await updateDoc(infoRef, {
          email,
          has_password: true,
          password_hash: hash,
          password_salt: salt,
          updated_at: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, path);
      }
    } else {
      try {
        await setDoc(infoRef, {
          uid,
          email,
          has_password: true,
          password_hash: hash,
          password_salt: salt,
          created_at: serverTimestamp(),
          updated_at: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, path);
      }
    }
    saveCachedHasPassword(uid, true);
    return { success: true };
  },

  verifyAccountPassword: async (password: string): Promise<boolean> => {
    const uid = requireUid();
    const infoRef = doc(db, 'users', uid, 'private', 'info');
    const path = `users/${uid}/private/info`;
    try {
      const snap = await getDocFromServer(infoRef).catch(() => getDoc(infoRef));
      if (!snap.exists()) return false;
      const d = snap.data();
      if (!d.has_password || !d.password_hash || !d.password_salt) return false;
      return await verifyPassword(password, String(d.password_salt), String(d.password_hash));
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, path);
    }
  },

  removeAccountPassword: async (): Promise<{ success: boolean }> => {
    const uid = requireUid();
    const email = (auth.currentUser?.email || `${uid}@users.sync`).slice(0, 200);
    const infoRef = doc(db, 'users', uid, 'private', 'info');
    const path = `users/${uid}/private/info`;
    try {
      const snap = await getDoc(infoRef);
      if (snap.exists()) {
        await updateDoc(infoRef, {
          email,
          has_password: false,
          password_hash: '',
          password_salt: '',
          updated_at: serverTimestamp(),
        });
      }
      saveCachedHasPassword(uid, false);
      return { success: true };
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  },

  deleteAccount: async (): Promise<{ success: boolean }> => {
    const uid = requireUid();
    clearCachedMe();
    try {
      localStorage.removeItem(`${HAS_PWD_STORAGE_PREFIX}${uid}`);
    } catch {}

    // 1. Delete user's comments & likes first so post counters stay valid
    try {
      const myCommentsSnap = await getDocs(query(collection(db, 'comments'), where('user_id', '==', uid)));
      for (const cDoc of myCommentsSnap.docs) {
        await api.deleteComment(cDoc.id).catch(() => deleteDoc(cDoc.ref).catch(() => {}));
      }
    } catch {}

    try {
      const myLikesSnap = await getDocs(query(collection(db, 'likes'), where('user_id', '==', uid)));
      for (const lDoc of myLikesSnap.docs) {
        const postId = lDoc.data().post_id;
        if (postId) {
          await api.unlikePost(postId).catch(() => deleteDoc(lDoc.ref).catch(() => {}));
        }
      }
    } catch {}

    // 2. Delete user's own posts, stories, bookmarks, blocks, notifications, follows, and requests
    const deleteSnapDocs = async (q: ReturnType<typeof query>) => {
      try {
        const snap = await getDocs(q);
        for (const d of snap.docs) {
          await deleteDoc(d.ref).catch(() => {});
        }
      } catch {}
    };

    await Promise.all([
      deleteSnapDocs(query(collection(db, 'posts'), where('user_id', '==', uid))),
      deleteSnapDocs(query(collection(db, 'stories'), where('user_id', '==', uid))),
      deleteSnapDocs(query(collection(db, 'close_friends_stories'), where('viewer_ids', 'array-contains', uid))),
      deleteSnapDocs(query(collection(db, 'story_highlights'), where('user_id', '==', uid))),
      deleteSnapDocs(query(collection(db, 'comment_likes'), where('user_id', '==', uid))),
      deleteSnapDocs(query(collection(db, 'users', uid, 'close_friends'), where('user_id', '==', uid))),
      deleteSnapDocs(query(collection(db, 'bookmarks'), where('user_id', '==', uid))),
      deleteSnapDocs(query(collection(db, 'blocks'), where('blocker_id', '==', uid))),
      deleteSnapDocs(query(collection(db, 'notifications'), where('user_id', '==', uid))),
      deleteSnapDocs(query(collection(db, 'follows'), where('follower_id', '==', uid))),
      deleteSnapDocs(query(collection(db, 'follows'), where('following_id', '==', uid))),
      deleteSnapDocs(query(collection(db, 'follow_requests'), where('requester_id', '==', uid))),
      deleteSnapDocs(query(collection(db, 'follow_requests'), where('target_id', '==', uid))),
    ]);

    try {
      await deleteDoc(doc(db, 'notes', uid));
    } catch {}

    // 3. Delete private PII/security info, presence status, and public user profile document
    try {
      await deleteDoc(doc(db, 'users', uid, 'private', 'info'));
    } catch {}
    try {
      await deleteDoc(doc(db, 'presence', uid));
    } catch {}

    const userPath = `users/${uid}`;
    try {
      await deleteDoc(doc(db, 'users', uid));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, userPath);
    }

    return { success: true };
  },

  // Real-time Presence (shared ref-counted Firestore listeners so online dots work everywhere without duplicate listeners)
  getCachedUserPresence: (userId?: string | null): boolean => {
    if (!userId) return false;
    if (auth.currentUser?.uid === userId && typeof document !== 'undefined' && document.visibilityState !== 'hidden') {
      const cached = presenceMemoryCache.get(userId);
      if (!cached) return true;
    }
    return isPresenceActive(presenceMemoryCache.get(userId));
  },

  updateMyPresence: async (online: boolean): Promise<void> => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    presenceMemoryCache.set(uid, { online, lastSeenMs: Date.now() });
    notifyPresenceSubscribers(uid);
    try {
      await setDoc(doc(db, 'presence', uid), {
        user_id: uid,
        online,
        last_seen_at: serverTimestamp(),
      });
    } catch {
      // Best-effort heartbeat; avoid surfacing transient offline or sign-out errors
    }
  },

  subscribeUserPresence: (
    userId: string,
    onChange: (isOnline: boolean) => void
  ): (() => void) => {
    if (!userId) {
      onChange(false);
      return () => {};
    }

    let subs = presenceSubscribers.get(userId);
    if (!subs) {
      subs = new Set();
      presenceSubscribers.set(userId, subs);
    }
    subs.add(onChange);
    ensurePresenceStaleSweep();

    const initialActive = isPresenceActive(presenceMemoryCache.get(userId));
    presenceLastNotified.set(userId, initialActive);
    onChange(initialActive);

    if (!presenceFirestoreUnsubs.has(userId)) {
      const unsub = onSnapshot(
        doc(db, 'presence', userId),
        (snap) => {
          if (!snap.exists()) {
            presenceMemoryCache.set(userId, { online: false, lastSeenMs: 0 });
            notifyPresenceSubscribers(userId);
            return;
          }
          const d = snap.data();
          const lastSeenMs = d.last_seen_at
            ? new Date(toIsoString(d.last_seen_at)).getTime()
            : Date.now();
          presenceMemoryCache.set(userId, { online: !!d.online, lastSeenMs });
          notifyPresenceSubscribers(userId);
        },
        () => {
          presenceMemoryCache.set(userId, { online: false, lastSeenMs: 0 });
          notifyPresenceSubscribers(userId);
        }
      );
      presenceFirestoreUnsubs.set(userId, unsub);
    }

    return () => {
      const currentSubs = presenceSubscribers.get(userId);
      if (currentSubs) {
        currentSubs.delete(onChange);
        if (currentSubs.size === 0) {
          presenceSubscribers.delete(userId);
          presenceLastNotified.delete(userId);
          const unsub = presenceFirestoreUnsubs.get(userId);
          if (unsub) {
            unsub();
            presenceFirestoreUnsubs.delete(userId);
          }
        }
      }
      stopPresenceStaleSweepIfIdle();
    };
  },

  subscribeUsersPresence: (
    userIds: string[],
    onChange: (presenceMap: Record<string, boolean>) => void
  ): (() => void) => {
    const uniqueIds = Array.from(new Set(userIds.filter(Boolean))).slice(0, 40);
    const map: Record<string, boolean> = {};
    uniqueIds.forEach((uid) => {
      map[uid] = isPresenceActive(presenceMemoryCache.get(uid));
    });
    onChange({ ...map });
    if (uniqueIds.length === 0) return () => {};

    const unsubs = uniqueIds.map((uid) =>
      api.subscribeUserPresence(uid, (active) => {
        if (map[uid] !== active) {
          map[uid] = active;
          onChange({ ...map });
        }
      })
    );

      return () => {
      unsubs.forEach((u) => u());
    };
  },

  // Sync Points (SP) & 30-Minute Epoch Leaderboard
  getLeaderboardEpochInfo,

  awardSyncPoints: async (
    action: 'post' | 'comment' | 'repost' | 'quote' | 'story'
  ): Promise<LeaderboardEntry | null> => {
    const uid = auth.currentUser?.uid;
    if (!uid) return null;
    return awardSyncPointsInternal(uid, action);
  },

  getMySyncPoints: async (): Promise<LeaderboardEntry | null> => {
    const uid = auth.currentUser?.uid || getCachedMe()?.id;
    if (!uid) return null;
    try {
      const snap = await getDoc(doc(db, 'sync_points', uid));
      if (snap.exists()) {
        const d = snap.data();
        const entry: LeaderboardEntry = {
          user_id: d.user_id || snap.id,
          username: d.username,
          display_name: d.display_name,
          avatar_url: d.avatar_url || '',
          is_verified: !!d.is_verified,
          points: typeof d.points === 'number' ? d.points : 0,
          daily_unlocked_day: d.daily_unlocked_day || '',
          streak_days: typeof d.streak_days === 'number' ? d.streak_days : 0,
          interactions_count: typeof d.interactions_count === 'number' ? d.interactions_count : 0,
          updated_at: toIsoString(d.updated_at),
        };
        try {
          localStorage.setItem(`${MY_SP_STORAGE_PREFIX}${uid}`, JSON.stringify(entry));
        } catch {}
        return entry;
      }
    } catch {}

    try {
      const cachedRaw = localStorage.getItem(`${MY_SP_STORAGE_PREFIX}${uid}`);
      if (cachedRaw) return JSON.parse(cachedRaw) as LeaderboardEntry;
    } catch {}

    const actor = await getFastActorDoc(uid).catch(() => null);
    if (!actor) return null;
    return {
      user_id: actor.id,
      username: actor.username,
      display_name: actor.display_name,
      avatar_url: actor.avatar_url || '',
      is_verified: !!actor.is_verified,
      points: 0,
      daily_unlocked_day: '',
      streak_days: 0,
      interactions_count: 0,
      updated_at: new Date().toISOString(),
    };
  },

  getCachedLeaderboard: (): { entries: LeaderboardEntry[]; epoch: number } | null => {
    const { epoch } = getLeaderboardEpochInfo();
    if (leaderboardMemoryCache && leaderboardMemoryCache.entries.length > 0) {
      return { entries: leaderboardMemoryCache.entries, epoch: leaderboardMemoryCache.epoch };
    }
    try {
      const raw = localStorage.getItem(LEADERBOARD_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.entries) && parsed.entries.length > 0) {
        leaderboardMemoryCache = {
          epoch: typeof parsed.epoch === 'number' ? parsed.epoch : epoch,
          entries: parsed.entries,
          ts: parsed.ts || Date.now(),
        };
        return { entries: parsed.entries, epoch: leaderboardMemoryCache.epoch };
      }
    } catch {}
    return null;
  },

  getLeaderboard: async (forceRefresh = false): Promise<{
    entries: LeaderboardEntry[];
    epoch: number;
    lastRefreshMs: number;
    nextRefreshMs: number;
  }> => {
    const epochInfo = getLeaderboardEpochInfo();
    if (!forceRefresh && leaderboardMemoryCache && leaderboardMemoryCache.epoch === epochInfo.epoch && leaderboardMemoryCache.entries.length > 0) {
      return {
        entries: leaderboardMemoryCache.entries,
        epoch: epochInfo.epoch,
        lastRefreshMs: epochInfo.lastRefreshMs,
        nextRefreshMs: epochInfo.nextRefreshMs,
      };
    }

    if (!forceRefresh) {
      try {
        const raw = localStorage.getItem(LEADERBOARD_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.epoch === epochInfo.epoch && Array.isArray(parsed?.entries) && parsed.entries.length > 0) {
            leaderboardMemoryCache = {
              epoch: epochInfo.epoch,
              entries: parsed.entries,
              ts: parsed.ts || Date.now(),
            };
            return {
              entries: parsed.entries,
              epoch: epochInfo.epoch,
              lastRefreshMs: epochInfo.lastRefreshMs,
              nextRefreshMs: epochInfo.nextRefreshMs,
            };
          }
        }
      } catch {}
    }

    try {
      const [spSnap, usersSnap] = await Promise.all([
        getDocs(query(collection(db, 'sync_points'), orderBy('points', 'desc'), limit(50))).catch(() => null),
        getDocs(query(collection(db, 'users'), limit(30))).catch(() => null),
      ]);

      const byUser = new Map<string, LeaderboardEntry>();

      if (spSnap) {
        spSnap.docs.forEach((d) => {
          const data = d.data();
          byUser.set(d.id, {
            user_id: data.user_id || d.id,
            username: data.username,
            display_name: data.display_name,
            avatar_url: data.avatar_url || '',
            is_verified: !!data.is_verified,
            points: typeof data.points === 'number' ? data.points : 0,
            daily_unlocked_day: data.daily_unlocked_day || '',
            streak_days: typeof data.streak_days === 'number' ? data.streak_days : 0,
            interactions_count: typeof data.interactions_count === 'number' ? data.interactions_count : 0,
            updated_at: toIsoString(data.updated_at),
          });
        });
      }

      if (usersSnap) {
        usersSnap.docs.forEach((d) => {
          const u = d.data();
          const uid = u.id || d.id;
          if (!byUser.has(uid)) {
            byUser.set(uid, {
              user_id: uid,
              username: u.username,
              display_name: u.display_name,
              avatar_url: u.avatar_url || '',
              is_verified: !!u.is_verified,
              points: 0,
              daily_unlocked_day: '',
              streak_days: 0,
              interactions_count: 0,
              updated_at: toIsoString(u.updated_at),
            });
          } else {
            // Ensure latest user avatar / display name / verification is mirrored
            const existing = byUser.get(uid)!;
            byUser.set(uid, {
              ...existing,
              username: u.username || existing.username,
              display_name: u.display_name || existing.display_name,
              avatar_url: u.avatar_url ?? existing.avatar_url,
              is_verified: !!u.is_verified,
            });
          }
        });
      }

      const entries = Array.from(byUser.values()).sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        if (b.interactions_count !== a.interactions_count) return b.interactions_count - a.interactions_count;
        return a.display_name.localeCompare(b.display_name);
      });

      leaderboardMemoryCache = {
        epoch: epochInfo.epoch,
        entries,
        ts: Date.now(),
      };
      try {
        localStorage.setItem(
          LEADERBOARD_STORAGE_KEY,
          JSON.stringify({ epoch: epochInfo.epoch, entries: entries.slice(0, 50), ts: Date.now() })
        );
      } catch {}

      return {
        entries,
        epoch: epochInfo.epoch,
        lastRefreshMs: epochInfo.lastRefreshMs,
        nextRefreshMs: epochInfo.nextRefreshMs,
      };
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'sync_points');
    }
  },

  // ==================== REAL-TIME LIVE SUBSCRIPTIONS (< 1s) ====================

  syncLiveEngagementSession: (uid?: string | null) => {
    ensureLiveEngagementStore(uid);
  },

  subscribeFeed: (
    params: { feed?: string; tag?: string },
    onUpdate: (posts: Post[]) => void
  ): (() => void) => {
    const currentUid = auth.currentUser?.uid;
    ensureLiveEngagementStore(currentUid);

    const feed = params?.feed || 'for_you';
    const tag = params?.tag?.replace('#', '').toLowerCase();
    const cacheKey = getFeedKey(params);

    let latestRawDocs: any[] = [];
    let hasSnapshot = false;

    const emitFiltered = () => {
      if (!hasSnapshot) return;
      let rows = latestRawDocs;
      if (currentUid && liveBlocksReady) {
        rows = rows.filter((p) => !liveBlockedUserIds.has(p.user_id));
      }
      if (currentUid && feed === 'following' && liveFollowingReady) {
        rows = rows.filter((p) => p.user_id === currentUid || liveFollowingUserIds.has(p.user_id));
      }
      if (tag) {
        rows = rows.filter((p) => (p.content || '').toLowerCase().includes(`#${tag}`));
      }
      const posts = mapRawDocsToPosts(rows, liveLikedPostIds, liveBookmarkedPostIds);
      saveFeedCache(cacheKey, posts);
      onUpdate(posts);
    };

    const unsubEngagement = subscribeToEngagementListeners(emitFiltered);
    const unsubPosts = onSnapshot(
      query(collection(db, 'posts'), orderBy('created_at', 'desc'), limit(40)),
      (snap) => {
        latestRawDocs = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
        hasSnapshot = true;
        emitFiltered();
      },
      () => {}
    );

    return () => {
      unsubEngagement();
      unsubPosts();
    };
  },

  subscribeComments: (
    postId: string,
    onUpdate: (comments: Comment[]) => void
  ): (() => void) => {
    const currentUid = auth.currentUser?.uid;
    ensureLiveEngagementStore(currentUid);
    let latestDocs: any[] = [];
    let hasSnapshot = false;

    const emit = () => {
      if (!hasSnapshot) return;
      const comments: Comment[] = latestDocs
        .map((data) => ({
          id: data.id,
          post_id: data.post_id,
          user_id: data.user_id,
          parent_id: data.parent_id || null,
          content: data.content,
          likes_count: data.likes_count || 0,
          is_liked: liveLikedCommentIds.has(data.id),
          created_at: toIsoString(data.created_at),
          username: data.username,
          display_name: data.display_name,
          avatar_url: data.avatar_url || '',
          is_verified: !!data.is_verified,
        }))
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      onUpdate(comments);
    };

    const unsubEng = subscribeToEngagementListeners(emit);
    const unsubCmt = onSnapshot(
      query(collection(db, 'comments'), where('post_id', '==', postId)),
      (snap) => {
        latestDocs = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
        hasSnapshot = true;
        emit();
      },
      () => {}
    );

    return () => {
      unsubEng();
      unsubCmt();
    };
  },

  subscribeNotifications: (
    onUpdate: (notifications: NotificationItem[]) => void
  ): (() => void) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return () => {};
    return onSnapshot(
      query(collection(db, 'notifications'), where('user_id', '==', uid)),
      (snap) => {
        const notifications: NotificationItem[] = snap.docs
          .map((d) => {
            const n = d.data();
            return {
              id: d.id,
              user_id: n.user_id,
              actor_id: n.actor_id,
              type: n.type,
              target_id: n.target_id || '',
              read: n.read ? 1 : 0,
              created_at: toIsoString(n.created_at),
              actor_username: n.actor_username,
              actor_display_name: n.actor_display_name,
              actor_avatar_url: n.actor_avatar_url || '',
              actor_verified: n.actor_verified ? 1 : 0,
            };
          })
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .slice(0, 50);
        notificationsMemoryCache = { uid, items: notifications, ts: Date.now() };
        onUpdate(notifications);
      },
      () => {}
    );
  },

  subscribeBookmarks: (
    onUpdate: (posts: Post[]) => void
  ): (() => void) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return () => {};
    ensureLiveEngagementStore(uid);

    let active = true;
    let bookmarkedOrder: Array<{ postId: string; createdAtMs: number }> = [];
    const postCache = new Map<string, any>();

    const emit = () => {
      if (!active) return;
      const rawPosts = bookmarkedOrder
        .map((item) => postCache.get(item.postId))
        .filter(Boolean);
      const posts = mapRawDocsToPosts(rawPosts, liveLikedPostIds, liveBookmarkedPostIds);
      bookmarksMemoryCache = { uid, posts, ts: Date.now() };
      onUpdate(posts);
    };

    const unsubEng = subscribeToEngagementListeners(emit);
    const unsubFeedMirror = onSnapshot(
      query(collection(db, 'posts'), orderBy('created_at', 'desc'), limit(40)),
      (snap) => {
        snap.docs.forEach((d) => {
          postCache.set(d.id, { ...d.data(), id: d.id });
        });
        emit();
      },
      () => {}
    );

    const unsubBmk = onSnapshot(
      query(collection(db, 'bookmarks'), where('user_id', '==', uid)),
      async (snap) => {
        bookmarkedOrder = snap.docs
          .map((d) => {
            const data = d.data();
            return {
              postId: data.post_id as string,
              createdAtMs: new Date(toIsoString(data.created_at)).getTime(),
            };
          })
          .filter((x) => Boolean(x.postId))
          .sort((a, b) => b.createdAtMs - a.createdAtMs);

        const missingIds = bookmarkedOrder
          .map((x) => x.postId)
          .filter((pid) => !postCache.has(pid));

        if (missingIds.length > 0) {
          const snaps = await Promise.all(missingIds.map((pid) => getDoc(doc(db, 'posts', pid)).catch(() => null)));
          snaps.forEach((s) => {
            if (s && s.exists()) {
              postCache.set(s.id, { ...s.data(), id: s.id });
            }
          });
        }
        emit();
      },
      () => {}
    );

    return () => {
      active = false;
      unsubEng();
      unsubFeedMirror();
      unsubBmk();
    };
  },

  subscribeStories: (
    onUpdate: (storyGroups: StoryGroup[]) => void
  ): (() => void) => {
    const currentUid = auth.currentUser?.uid;
    let publicDocs: any[] = [];
    let cfDocs: any[] = [];
    let publicReady = false;

    const buildAndEmit = () => {
      if (!publicReady) return;
      const nowMs = Date.now();
      const viewedMap = getViewedStoriesMap(currentUid);
      const mergedRaw: Array<{ data: any; audience: 'everyone' | 'close_friends' }> = [];

      publicDocs.forEach((s) => {
        if (new Date(toIsoString(s.expires_at)).getTime() > nowMs) {
          storyCollectionMap.set(s.id, 'stories');
          mergedRaw.push({ data: s, audience: 'everyone' });
        }
      });
      cfDocs.forEach((s) => {
        if (new Date(toIsoString(s.expires_at)).getTime() > nowMs) {
          storyCollectionMap.set(s.id, 'close_friends_stories');
          mergedRaw.push({ data: s, audience: 'close_friends' });
        }
      });

      mergedRaw.sort(
        (a, b) =>
          new Date(toIsoString(a.data.created_at)).getTime() -
          new Date(toIsoString(b.data.created_at)).getTime()
      );

      const userMap = new Map<string, StoryGroup>();
      for (const { data: item, audience } of mergedRaw) {
        if (!userMap.has(item.user_id)) {
          userMap.set(item.user_id, {
            userId: item.user_id,
            username: item.username,
            displayName: item.display_name,
            avatarUrl: item.avatar_url || '',
            isVerified: !!item.is_verified,
            hasUnviewed: false,
            hasCloseFriends: false,
            stories: [],
          });
        }
        const group = userMap.get(item.user_id)!;
        const isViewed = !!viewedMap[item.id];
        if (!isViewed) group.hasUnviewed = true;
        if (audience === 'close_friends') group.hasCloseFriends = true;
        group.stories.push({
          id: item.id,
          imageUrl: item.image_url,
          caption: item.caption || '',
          tags: Array.isArray(item.tags) ? item.tags : [],
          audience,
          createdAt: toIsoString(item.created_at),
          expiresAt: toIsoString(item.expires_at),
          isViewed,
        });
      }

      const storyGroups = Array.from(userMap.values()).sort((a, b) => {
        if (currentUid) {
          if (a.userId === currentUid && b.userId !== currentUid) return -1;
          if (b.userId === currentUid && a.userId !== currentUid) return 1;
        }
        if (a.hasUnviewed !== b.hasUnviewed) return a.hasUnviewed ? -1 : 1;
        const aLatest = new Date(a.stories[a.stories.length - 1]?.createdAt || 0).getTime();
        const bLatest = new Date(b.stories[b.stories.length - 1]?.createdAt || 0).getTime();
        return bLatest - aLatest;
      });

      saveStoriesCache(storyGroups);
      onUpdate(storyGroups);
    };

    const unsubPublic = onSnapshot(
      query(
        collection(db, 'stories'),
        where('expires_at', '>', Timestamp.now()),
        orderBy('expires_at', 'desc'),
        limit(40)
      ),
      (snap) => {
        publicDocs = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
        publicReady = true;
        buildAndEmit();
      },
      () => {}
    );

    const unsubCf = currentUid
      ? onSnapshot(
          query(
            collection(db, 'close_friends_stories'),
            where('viewer_ids', 'array-contains', currentUid)
          ),
          (snap) => {
            cfDocs = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
            buildAndEmit();
          },
          () => {}
        )
      : () => {};

    return () => {
      unsubPublic();
      unsubCf();
    };
  },

  subscribeUserProfile: (
    profileId: string,
    usernameLower: string,
    callbacks: {
      onUserPatch: (patch: Partial<User>) => void;
      onPosts: (posts: Post[]) => void;
    }
  ): (() => void) => {
    const currentUid = auth.currentUser?.uid;
    ensureLiveEngagementStore(currentUid);

    let rawPosts: any[] = [];
    let postsReady = false;

    const emitPosts = () => {
      if (!postsReady) return;
      const posts = mapRawDocsToPosts(rawPosts, liveLikedPostIds, liveBookmarkedPostIds);
      userPostsMemoryCache.set(usernameLower, {
        uid: currentUid || '',
        posts,
        ts: Date.now(),
      });
      saveStoredUserPosts(usernameLower, posts);
      callbacks.onPosts(posts);
    };

    const unsubEng = subscribeToEngagementListeners(() => {
      emitPosts();
      if (currentUid && currentUid !== profileId && liveFollowingReady) {
        callbacks.onUserPatch({ is_following: liveFollowingUserIds.has(profileId) });
      }
      if (currentUid && currentUid !== profileId && liveBlocksReady) {
        callbacks.onUserPatch({ is_blocked_by_me: liveBlockedUserIds.has(profileId) });
      }
    });

    const unsubUserDoc = onSnapshot(
      doc(db, 'users', profileId),
      (snap) => {
        if (!snap.exists()) return;
        const d = snap.data();
        callbacks.onUserPatch({
          username: d.username,
          display_name: d.display_name,
          bio: d.bio || '',
          avatar_url: d.avatar_url || '',
          banner_url: d.banner_url || '',
          website: d.website || '',
          location: d.location || '',
          is_verified: !!d.is_verified,
          is_private: !!d.is_private,
        });
      },
      () => {}
    );

    const unsubPosts = onSnapshot(
      query(collection(db, 'posts'), where('user_id', '==', profileId)),
      (snap) => {
        rawPosts = snap.docs
          .map((d) => ({ ...d.data(), id: d.id }))
          .sort(
            (a: any, b: any) =>
              new Date(toIsoString(b.created_at)).getTime() -
              new Date(toIsoString(a.created_at)).getTime()
          );
        postsReady = true;
        callbacks.onUserPatch({ posts_count: rawPosts.length });
        emitPosts();
      },
      () => {}
    );

    const unsubFollowers = onSnapshot(
      query(collection(db, 'follows'), where('following_id', '==', profileId)),
      (snap) => {
        const patch: Partial<User> = { followers_count: snap.size };
        if (currentUid && currentUid !== profileId) {
          patch.is_following = snap.docs.some((d) => d.data().follower_id === currentUid);
        }
        callbacks.onUserPatch(patch);
      },
      () => {}
    );

    const unsubFollowing = onSnapshot(
      query(collection(db, 'follows'), where('follower_id', '==', profileId)),
      (snap) => {
        callbacks.onUserPatch({ following_count: snap.size });
      },
      () => {}
    );

    return () => {
      unsubEng();
      unsubUserDoc();
      unsubPosts();
      unsubFollowers();
      unsubFollowing();
    };
  },

  subscribeSuggestedUsers: (
    onUpdate: (users: User[]) => void
  ): (() => void) => {
    const currentUid = auth.currentUser?.uid;
    ensureLiveEngagementStore(currentUid);
    let latestDocs: any[] = [];
    let ready = false;

    const emit = () => {
      if (!ready) return;
      const users: User[] = latestDocs
        .filter((d) => d.id !== currentUid)
        .slice(0, 12)
        .map((u) => ({
          id: u.id,
          username: u.username,
          display_name: u.display_name,
          bio: u.bio || '',
          avatar_url: u.avatar_url || '',
          is_verified: !!u.is_verified,
          is_private: !!u.is_private,
          is_following: liveFollowingUserIds.has(u.id),
        }));
      suggestedUsersMemoryCache = { uid: currentUid || '', users, ts: Date.now() };
      onUpdate(users);
    };

    const unsubEng = subscribeToEngagementListeners(emit);
    const unsubUsers = onSnapshot(
      query(collection(db, 'users'), limit(25)),
      (snap) => {
        latestDocs = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
        ready = true;
        emit();
      },
      () => {}
    );

    return () => {
      unsubEng();
      unsubUsers();
    };
  },

  subscribeMySyncPoints: (
    uid: string,
    onUpdate: (entry: LeaderboardEntry) => void
  ): (() => void) => {
    if (!uid) return () => {};
    return onSnapshot(
      doc(db, 'sync_points', uid),
      (snap) => {
        if (!snap.exists()) return;
        const d = snap.data();
        const entry: LeaderboardEntry = {
          user_id: d.user_id || snap.id,
          username: d.username,
          display_name: d.display_name,
          avatar_url: d.avatar_url || '',
          is_verified: !!d.is_verified,
          points: typeof d.points === 'number' ? d.points : 0,
          daily_unlocked_day: d.daily_unlocked_day || '',
          streak_days: typeof d.streak_days === 'number' ? d.streak_days : 0,
          interactions_count: typeof d.interactions_count === 'number' ? d.interactions_count : 0,
          updated_at: toIsoString(d.updated_at),
        };
        try {
          localStorage.setItem(`${MY_SP_STORAGE_PREFIX}${uid}`, JSON.stringify(entry));
        } catch {}
        syncLeaderboardCacheEntry(entry);
        onUpdate(entry);
      },
      () => {}
    );
  },

  subscribeLeaderboard: (
    onUpdate: (entries: LeaderboardEntry[]) => void
  ): (() => void) => {
    return onSnapshot(
      query(collection(db, 'sync_points'), orderBy('points', 'desc'), limit(50)),
      (snap) => {
        const spEntries: LeaderboardEntry[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            user_id: data.user_id || d.id,
            username: data.username,
            display_name: data.display_name,
            avatar_url: data.avatar_url || '',
            is_verified: !!data.is_verified,
            points: typeof data.points === 'number' ? data.points : 0,
            daily_unlocked_day: data.daily_unlocked_day || '',
            streak_days: typeof data.streak_days === 'number' ? data.streak_days : 0,
            interactions_count: typeof data.interactions_count === 'number' ? data.interactions_count : 0,
            updated_at: toIsoString(data.updated_at),
          };
        });
        if (spEntries.length > 0) {
          const { epoch } = getLeaderboardEpochInfo();
          const prevMap = new Map<string, LeaderboardEntry>();
          (leaderboardMemoryCache?.entries || []).forEach((e) => prevMap.set(e.user_id, e));
          spEntries.forEach((e) => prevMap.set(e.user_id, e));
          const merged = Array.from(prevMap.values()).sort((a, b) => {
            if (b.points !== a.points) return b.points - a.points;
            if (b.interactions_count !== a.interactions_count) return b.interactions_count - a.interactions_count;
            return a.display_name.localeCompare(b.display_name);
          });
          leaderboardMemoryCache = { epoch, entries: merged, ts: Date.now() };
          try {
            localStorage.setItem(
              LEADERBOARD_STORAGE_KEY,
              JSON.stringify({ epoch, entries: merged.slice(0, 50), ts: Date.now() })
            );
          } catch {}
          onUpdate(merged);
        }
      },
      () => {}
    );
  },
};
