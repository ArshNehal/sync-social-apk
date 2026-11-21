import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  reauthenticateWithPopup,
  signOut,
  deleteUser,
  GoogleAuthProvider,
} from 'firebase/auth';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { User, SavedAccount } from '../types';
import { api, ensureUserProfile, ensureUserProfileWithMeta } from '../lib/api';
import { soundFX } from '../lib/sounds';
import {
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  isPersistentBrowserStorageAvailable,
  OperationType,
} from '../lib/firebase';

const REQUIRE_PWD_UID_KEY = 'sync_require_pwd_uid';
const REQUIRE_PWD_UIDS_KEY = 'sync_require_pwd_uids_v1';
const SAVED_ACCOUNTS_KEY = 'sync_saved_accounts_v1';

export interface SwitchAccountResult {
  status: 'switched' | 'password_required' | 'same_account' | 'cancelled' | 'error';
  message?: string;
  user?: User;
}

function loadSavedAccounts(): SavedAccount[] {
  try {
    const raw = localStorage.getItem(SAVED_ACCOUNTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((a): a is SavedAccount => Boolean(a && a.uid && a.username))
      .sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0));
  } catch {
    return [];
  }
}

function upsertSavedAccountList(profile: User, email?: string): SavedAccount[] {
  const existing = loadSavedAccounts();
  const prev = existing.find((a) => a.uid === profile.id);
  const nextEntry: SavedAccount = {
    uid: profile.id,
    email: email || profile.email || prev?.email || '',
    username: profile.username,
    display_name: profile.display_name,
    avatar_url: profile.avatar_url || '',
    is_verified: !!profile.is_verified,
    lastUsedAt: Date.now(),
  };
  const next = [nextEntry, ...existing.filter((a) => a.uid !== profile.id)].slice(0, 10);
  try {
    localStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(next));
  } catch {}
  return next;
}

function removeSavedAccountFromList(uid: string): SavedAccount[] {
  const next = loadSavedAccounts().filter((a) => a.uid !== uid);
  try {
    localStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(next));
  } catch {}
  return next;
}

function loadRequirePwdUids(): string[] {
  try {
    const raw = localStorage.getItem(REQUIRE_PWD_UIDS_KEY);
    const list: string[] = raw ? JSON.parse(raw) : [];
    const legacy = localStorage.getItem(REQUIRE_PWD_UID_KEY);
    const merged = Array.isArray(list) ? list.filter((x) => typeof x === 'string' && x) : [];
    if (legacy && !merged.includes(legacy)) merged.push(legacy);
    return merged;
  } catch {
    return [];
  }
}

function shouldRequirePasswordCheck(uid: string): boolean {
  if (!uid) return false;
  return loadRequirePwdUids().includes(uid);
}

function markRequirePasswordCheck(uid: string) {
  if (!uid) return;
  try {
    const next = Array.from(new Set([...loadRequirePwdUids(), uid]));
    localStorage.setItem(REQUIRE_PWD_UIDS_KEY, JSON.stringify(next));
    localStorage.setItem(REQUIRE_PWD_UID_KEY, uid);
  } catch {}
}

function clearRequirePasswordCheck(uid?: string) {
  try {
    if (!uid) {
      localStorage.removeItem(REQUIRE_PWD_UIDS_KEY);
      localStorage.removeItem(REQUIRE_PWD_UID_KEY);
      return;
    }
    const next = loadRequirePwdUids().filter((id) => id !== uid);
    localStorage.setItem(REQUIRE_PWD_UIDS_KEY, JSON.stringify(next));
    if (localStorage.getItem(REQUIRE_PWD_UID_KEY) === uid) {
      localStorage.removeItem(REQUIRE_PWD_UID_KEY);
    }
  } catch {}
}

interface AuthContextType {
  user: User | null;
  pendingPasswordUser: User | null;
  loading: boolean;
  authConfirmedUid: string | null;
  storagePersistent: boolean;
  hasPasswordProvider: boolean;
  counts: { unreadNotifications: number; unreadMessages: number };
  brandName: string;
  setBrandName: (name: string) => void;
  signInWithGoogle: (loginHint?: string) => Promise<{
    user: User;
    isNewUser: boolean;
    passwordRequired: boolean;
    previousUid: string | null;
  }>;
  verifyAndUnlockPassword: (password: string) => Promise<boolean>;
  resetPasswordViaGoogle: (newPassword: string) => Promise<void>;
  cancelPendingPasswordSignIn: () => Promise<void>;
  setAccountPassword: (password: string) => Promise<void>;
  removeAccountPassword: () => Promise<void>;
  savedAccounts: SavedAccount[];
  accountSwitcherOpen: boolean;
  switchingAccountUid: string | null;
  openAccountSwitcher: () => void;
  closeAccountSwitcher: () => void;
  switchAccount: (account: SavedAccount) => Promise<SwitchAccountResult>;
  addNewAccount: () => void;
  removeSavedAccount: (uid: string) => void;
  requestLogout: () => void;
  cancelLogout: () => void;
  confirmLogout: () => Promise<void>;
  signOutConfirmOpen: boolean;
  logout: () => void;
  updateProfile: (data: Partial<User>, opts?: { silentToast?: boolean }) => Promise<void>;
  deleteAccount: () => Promise<void>;
  refreshMe: () => Promise<void>;
  authModalOpen: boolean;
  authModalTab: 'login' | 'register';
  openAuth: (tab?: 'login' | 'register') => void;
  closeAuth: () => void;
  activeToast: string | null;
  showToast: (msg: string) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function getInitialBootUser(): User | null {
  const cached = api.getCachedMe();
  if (cached && !shouldRequirePasswordCheck(cached.id)) {
    return cached;
  }
  return null;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [bootUser] = useState<User | null>(() => getInitialBootUser());
  const [user, setUser] = useState<User | null>(bootUser);
  const [pendingPasswordUser, setPendingPasswordUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(!bootUser);
  const [authConfirmedUid, setAuthConfirmedUid] = useState<string | null>(() => auth.currentUser?.uid || null);
  const [storagePersistent] = useState<boolean>(() => isPersistentBrowserStorageAvailable());
  const [hasPasswordProvider, setHasPasswordProvider] = useState<boolean>(() =>
    bootUser ? api.getCachedHasPassword(bootUser.id) : false
  );
  const [counts, setCounts] = useState({ unreadNotifications: 0, unreadMessages: 0 });
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalTab, setAuthModalTab] = useState<'login' | 'register'>('login');
  const [signOutConfirmOpen, setSignOutConfirmOpen] = useState(false);
  const [accountSwitcherOpen, setAccountSwitcherOpen] = useState(false);
  const [switchingAccountUid, setSwitchingAccountUid] = useState<string | null>(null);
  const [savedAccounts, setSavedAccounts] = useState<SavedAccount[]>(() => loadSavedAccounts());
  const [activeToast, setActiveToast] = useState<string | null>(null);
  const seenNotifIdsRef = useRef<Set<string>>(new Set());
  const initialNotifLoadRef = useRef(true);
  const activeUidRef = useRef<string | null>(bootUser?.id || auth.currentUser?.uid || null);
  const authOpInFlightRef = useRef(false);
  const switchingInFlightRef = useRef(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [brandName, setBrandNameState] = useState<string>(() => {
    try {
      const stored = localStorage.getItem('noir_brand_name');
      if (!stored || stored === 'ONYX' || stored === 'NOIR' || stored === 'qynx') {
        return 'SYNC';
      }
      return stored;
    } catch {
      return 'SYNC';
    }
  });

  const setBrandName = useCallback((name: string) => {
    const trimmed = name.trim() || 'SYNC';
    setBrandNameState(trimmed);
    try {
      localStorage.setItem('noir_brand_name', trimmed);
    } catch {}
    if (typeof document !== 'undefined') {
      document.title = `${trimmed} — A Social Space Without The Noise`;
    }
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.title = `${brandName} — A Social Space Without The Noise`;
    }
  }, [brandName]);

  const showToast = useCallback((msg: string) => {
    setActiveToast(msg);
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = setTimeout(() => {
      setActiveToast((prev) => (prev === msg ? null : prev));
      toastTimerRef.current = null;
    }, 3400);
  }, []);

  const syncSecurityInfo = useCallback(async (forceServer = false): Promise<boolean> => {
    if (!auth.currentUser) {
      setHasPasswordProvider(false);
      return false;
    }
    const info = await api
      .getPrivateSecurityInfo(forceServer)
      .catch(() => ({ hasPassword: api.getCachedHasPassword(auth.currentUser?.uid) }));
    setHasPasswordProvider(info.hasPassword);
    return info.hasPassword;
  }, []);

  const refreshMe = useCallback(async () => {
    if (!auth.currentUser) {
      api.clearCachedMe();
      setAuthConfirmedUid(null);
      setUser(null);
      setPendingPasswordUser(null);
      setHasPasswordProvider(false);
      setCounts({ unreadNotifications: 0, unreadMessages: 0 });
      setLoading(false);
      return;
    }
    try {
      const uid = auth.currentUser.uid;
      const needsPwd = shouldRequirePasswordCheck(uid);
      const profile = await ensureUserProfile(auth.currentUser);
      if (needsPwd) {
        const hasPwd = await syncSecurityInfo(true);
        if (hasPwd) {
          api.clearCachedMe();
          setAuthConfirmedUid(uid);
          setPendingPasswordUser(profile);
          setUser(null);
          setLoading(false);
          return;
        }
      }
      setPendingPasswordUser(null);
      setAuthConfirmedUid(uid);
      setUser(profile);
      api.saveCachedMe(profile);
      setSavedAccounts(upsertSavedAccountList(profile, auth.currentUser.email || profile.email));
      setLoading(false);
      syncSecurityInfo(false).catch(() => {});
      api.getMe(profile)
        .then((res) => setCounts(res.counts))
        .catch((countsErr) => console.warn('Non-fatal counts refresh warning:', countsErr));
    } catch (err) {
      console.warn('Error refreshing user profile:', err);
      setLoading(false);
    }
  }, [syncSecurityInfo]);

  // Persistent Firebase Auth state listener across browser sessions
  useEffect(() => {
    let active = true;
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      if (!active) return;

      if (!fbUser) {
        const hadUid = activeUidRef.current !== null;
        activeUidRef.current = null;
        if (hadUid) {
          api.clearAccountSwitchCaches();
        } else {
          api.clearCachedMe();
        }
        setAuthConfirmedUid(null);
        setUser(null);
        setPendingPasswordUser(null);
        setHasPasswordProvider(false);
        setCounts({ unreadNotifications: 0, unreadMessages: 0 });
        seenNotifIdsRef.current.clear();
        initialNotifLoadRef.current = true;
        setLoading(false);
        return;
      }

      // When signInWithGoogle is actively orchestrating an account switch/sign-in, avoid duplicate hydration races
      if (authOpInFlightRef.current) {
        return;
      }

      const prevUid = activeUidRef.current;
      if (prevUid && prevUid !== fbUser.uid) {
        api.clearAccountSwitchCaches();
        seenNotifIdsRef.current.clear();
        initialNotifLoadRef.current = true;
        setCounts({ unreadNotifications: 0, unreadMessages: 0 });
      }
      activeUidRef.current = fbUser.uid;

      try {
        const needsPwdCheck = shouldRequirePasswordCheck(fbUser.uid);
        if (needsPwdCheck) {
          const [profile, hasPwd] = await Promise.all([
            ensureUserProfile(fbUser),
            syncSecurityInfo(true),
          ]);
          if (!active || auth.currentUser?.uid !== fbUser.uid) return;
          if (hasPwd) {
            api.clearCachedMe();
            setAuthConfirmedUid(fbUser.uid);
            setPendingPasswordUser(profile);
            setUser(null);
            setLoading(false);
            return;
          }
          clearRequirePasswordCheck(fbUser.uid);
          setPendingPasswordUser(null);
          setAuthConfirmedUid(fbUser.uid);
          setUser(profile);
          api.saveCachedMe(profile);
          setSavedAccounts(upsertSavedAccountList(profile, fbUser.email || profile.email));
          setLoading(false);
          api.getMe(profile)
            .then((res) => {
              if (!active || auth.currentUser?.uid !== fbUser.uid) return;
              setCounts(res.counts);
            })
            .catch(() => {});
          return;
        }

        // Fast-path: hydrate immediately from local/IndexedDB user profile without blocking on server security check
        const profile = await ensureUserProfile(fbUser);
        if (!active || auth.currentUser?.uid !== fbUser.uid) return;

        setPendingPasswordUser(null);
        setAuthConfirmedUid(fbUser.uid);
        setUser(profile);
        api.saveCachedMe(profile);
        setSavedAccounts(upsertSavedAccountList(profile, fbUser.email || profile.email));
        setLoading(false);

        syncSecurityInfo(false).catch(() => {});
        api.getMe(profile)
          .then((res) => {
            if (!active || auth.currentUser?.uid !== fbUser.uid) return;
            setCounts(res.counts);
          })
          .catch((countsErr) => console.warn('Could not load initial unread counts:', countsErr));
      } catch (err) {
        console.error('Failed to hydrate Firebase user:', err);
        if (active) {
          showToast('Signed out or unable to restore session. Please sign in again.');
          setLoading(false);
        }
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [showToast, syncSecurityInfo]);

  // Real-time Firestore listeners for engagement store, notifications & conversations ONLY once Firebase Auth UID is confirmed
  useEffect(() => {
    if (!authConfirmedUid || !user?.id || user.id !== authConfirmedUid) {
      api.syncLiveEngagementSession(null);
      return;
    }

    api.syncLiveEngagementSession(authConfirmedUid);

    const notifQ = query(collection(db, 'notifications'), where('user_id', '==', user.id));
    const unsubNotif = onSnapshot(
      notifQ,
      (snapshot) => {
        let unread = 0;
        snapshot.docs.forEach((docSnap) => {
          const data = docSnap.data();
          if (!data.read) unread += 1;
          if (!initialNotifLoadRef.current && !seenNotifIdsRef.current.has(docSnap.id) && !data.read) {
            if (data.type === 'like') {
              soundFX.playNotification();
              showToast(`${data.actor_display_name} liked your post`);
            } else if (data.type === 'comment') {
              soundFX.playNotification();
              showToast(`${data.actor_display_name} commented on your post`);
            } else if (data.type === 'follow') {
              soundFX.playNotification();
              showToast(`${data.actor_display_name} started following you`);
            } else if (data.type === 'follow_request') {
              soundFX.playNotification();
              showToast(`${data.actor_display_name} requested to follow you`);
            } else if (data.type === 'message') {
              soundFX.playMessageReceived();
              showToast(`New message from ${data.actor_display_name}`);
            } else if (data.type === 'repost') {
              soundFX.playNotification();
              showToast(`${data.actor_display_name} reposted your post`);
            } else if (data.type === 'quote') {
              soundFX.playNotification();
              showToast(`${data.actor_display_name} quoted your post`);
            } else if (data.type === 'story_tag') {
              soundFX.playNotification();
              showToast(`${data.actor_display_name} tagged you in a story`);
            }
          }
          seenNotifIdsRef.current.add(docSnap.id);
        });
        initialNotifLoadRef.current = false;
        setCounts((prev) => ({ ...prev, unreadNotifications: unread }));
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'notifications');
      }
    );

    const convQ = query(collection(db, 'conversations'), where('member_ids', 'array-contains', user.id));
    const unsubConv = onSnapshot(
      convQ,
      () => {
        api.getMe()
          .then((res) => setCounts((prev) => ({ ...prev, unreadMessages: res.counts.unreadMessages })))
          .catch(() => {});
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'conversations');
      }
    );

    return () => {
      unsubNotif();
      unsubConv();
    };
  }, [authConfirmedUid, user?.id, showToast]);

  // Real-time online presence heartbeat while authenticated & tab is active
  useEffect(() => {
    if (!authConfirmedUid || !user?.id || user.id !== authConfirmedUid) return;

    const sendPresence = (online: boolean) => {
      api.updateMyPresence(online).catch(() => {});
    };

    sendPresence(typeof document === 'undefined' || document.visibilityState !== 'hidden');

    const heartbeat = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        sendPresence(true);
      }
    }, 45_000);

    const handleVisibility = () => {
      sendPresence(document.visibilityState === 'visible');
    };
    const handleFocus = () => sendPresence(true);
    const handleOfflineExit = () => sendPresence(false);

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('pagehide', handleOfflineExit);
    window.addEventListener('beforeunload', handleOfflineExit);

    return () => {
      clearInterval(heartbeat);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('pagehide', handleOfflineExit);
      window.removeEventListener('beforeunload', handleOfflineExit);
    };
  }, [authConfirmedUid, user?.id]);

  const signInWithGoogle = async (loginHint?: string): Promise<{
    user: User;
    isNewUser: boolean;
    passwordRequired: boolean;
    previousUid: string | null;
  }> => {
    const previousUid = auth.currentUser?.uid || activeUidRef.current || null;
    const provider = new GoogleAuthProvider();
    if (loginHint) {
      provider.setCustomParameters({ prompt: 'select_account', login_hint: loginHint });
    } else {
      provider.setCustomParameters({ prompt: 'select_account' });
    }

    authOpInFlightRef.current = true;
    try {
      const cred = await signInWithPopup(auth, provider);
      const nextUid = cred.user.uid;
      if (previousUid && previousUid !== nextUid) {
        api.clearAccountSwitchCaches();
        seenNotifIdsRef.current.clear();
        initialNotifLoadRef.current = true;
        setCounts({ unreadNotifications: 0, unreadMessages: 0 });
      }
      activeUidRef.current = nextUid;

      const res = await ensureUserProfileWithMeta(cred.user);
      const hasPwd = await syncSecurityInfo(true);
      setSavedAccounts(upsertSavedAccountList(res.user, cred.user.email || res.user.email));

      if (!res.isNewUser && hasPwd && shouldRequirePasswordCheck(nextUid)) {
        api.clearCachedMe();
        setAuthConfirmedUid(nextUid);
        setPendingPasswordUser(res.user);
        setUser(null);
        return { ...res, passwordRequired: true, previousUid };
      }

      clearRequirePasswordCheck(nextUid);
      setPendingPasswordUser(null);
      setAuthConfirmedUid(nextUid);
      setUser(res.user);
      api.saveCachedMe(res.user);
      api.getMe(res.user)
        .then((me) => {
          if (auth.currentUser?.uid === nextUid) {
            setCounts(me.counts);
          }
        })
        .catch(() => {});
      return { ...res, passwordRequired: false, previousUid };
    } finally {
      authOpInFlightRef.current = false;
    }
  };

  const openAccountSwitcher = useCallback(() => {
    setSavedAccounts(loadSavedAccounts());
    setAccountSwitcherOpen(true);
  }, []);

  const closeAccountSwitcher = useCallback(() => {
    if (switchingInFlightRef.current) return;
    setAccountSwitcherOpen(false);
  }, []);

  const switchAccount = useCallback(async (account: SavedAccount): Promise<SwitchAccountResult> => {
    if (switchingInFlightRef.current) {
      return { status: 'cancelled' };
    }
    switchingInFlightRef.current = true;
    setSwitchingAccountUid(account.uid);
    const prevUid = auth.currentUser?.uid || activeUidRef.current || null;

    try {
      const { user: switched, passwordRequired } = await signInWithGoogle(account.email || undefined);
      if (passwordRequired) {
        setAccountSwitcherOpen(false);
        return { status: 'password_required', user: switched };
      }

      // If user tried to switch to a different saved account, but Google signed back into the already-active UID
      if (prevUid && switched.id === prevUid && account.uid !== prevUid) {
        return {
          status: 'same_account',
          user: switched,
          message: `Google signed back into @${switched.username}. Please choose the Google account linked to @${account.username} in the popup.`,
        };
      }

      setAccountSwitcherOpen(false);
      soundFX.playSuccess();
      showToast(`Switched to @${switched.username}`);
      return { status: 'switched', user: switched };
    } catch (err: any) {
      const code = err?.code || '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        return { status: 'cancelled' };
      }
      if (code === 'auth/popup-blocked') {
        return {
          status: 'error',
          message: 'Popup was blocked by your browser. Please allow popups for this site and try again.',
        };
      }
      const message = err?.message || 'Could not switch account. Please try again.';
      return { status: 'error', message };
    } finally {
      switchingInFlightRef.current = false;
      setSwitchingAccountUid(null);
    }
  }, [showToast]);

  const addNewAccount = useCallback(() => {
    if (switchingInFlightRef.current) return;
    setAccountSwitcherOpen(false);
    setAuthModalTab('register');
    setAuthModalOpen(true);
  }, []);

  const removeSavedAccount = useCallback((uid: string) => {
    setSavedAccounts(removeSavedAccountFromList(uid));
  }, []);

  const verifyAndUnlockPassword = async (password: string): Promise<boolean> => {
    if (!auth.currentUser) return false;
    const valid = await api.verifyAccountPassword(password);
    if (!valid) return false;

    clearRequirePasswordCheck(auth.currentUser.uid);
    const profile = pendingPasswordUser || (await ensureUserProfile(auth.currentUser));
    setPendingPasswordUser(null);
    setAuthConfirmedUid(auth.currentUser.uid);
    setUser(profile);
    api.saveCachedMe(profile);
    setSavedAccounts(upsertSavedAccountList(profile, auth.currentUser.email || profile.email));
    api.getMe()
      .then((me) => {
        setUser(me.user);
        api.saveCachedMe(me.user);
        setSavedAccounts(upsertSavedAccountList(me.user, auth.currentUser?.email || me.user.email));
        setCounts(me.counts);
      })
      .catch(() => {});
    return true;
  };

  const resetPasswordViaGoogle = async (newPassword: string): Promise<void> => {
    const fbUser = auth.currentUser;
    if (!fbUser) {
      throw new Error('Please connect your Google account first.');
    }
    if (newPassword.length < 6) {
      throw new Error('Password must be at least 6 characters.');
    }
    await reauthenticateWithPopup(fbUser, googleProvider);
    await api.setAccountPassword(newPassword);
    setHasPasswordProvider(true);
    clearRequirePasswordCheck(fbUser.uid);
    const profile = pendingPasswordUser || (await ensureUserProfile(fbUser));
    setPendingPasswordUser(null);
    setAuthConfirmedUid(fbUser.uid);
    setUser(profile);
    api.saveCachedMe(profile);
    api.getMe()
      .then((me) => {
        setUser(me.user);
        api.saveCachedMe(me.user);
        setCounts(me.counts);
      })
      .catch(() => {});
  };

  const cancelPendingPasswordSignIn = async () => {
    setPendingPasswordUser(null);
    api.clearCachedMe();
    setAuthConfirmedUid(null);
    try {
      await signOut(auth);
    } catch {}
    setUser(null);
    setAuthModalOpen(false);
  };

  const setAccountPassword = async (newPassword: string): Promise<void> => {
    if (!auth.currentUser) {
      throw new Error('Please connect your Google account first before setting a password.');
    }
    if (newPassword.length < 6) {
      throw new Error('Password must be at least 6 characters.');
    }
    await api.setAccountPassword(newPassword);
    setHasPasswordProvider(true);
    clearRequirePasswordCheck(auth.currentUser.uid);
  };

  const removeAccountPassword = async (): Promise<void> => {
    if (!auth.currentUser) {
      throw new Error('You must be signed in.');
    }
    await api.removeAccountPassword();
    setHasPasswordProvider(false);
    clearRequirePasswordCheck(auth.currentUser.uid);
  };

  const requestLogout = useCallback(() => {
    setSignOutConfirmOpen(true);
  }, []);

  const cancelLogout = useCallback(() => {
    setSignOutConfirmOpen(false);
  }, []);

  const confirmLogout = async () => {
    const uid = auth.currentUser?.uid || user?.id;
    setSignOutConfirmOpen(false);
    if (uid) {
      markRequirePasswordCheck(uid);
    }
    activeUidRef.current = null;
    api.clearAccountSwitchCaches();
    seenNotifIdsRef.current.clear();
    initialNotifLoadRef.current = true;
    setAuthConfirmedUid(null);
    await Promise.race([
      api.updateMyPresence(false).catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 800)),
    ]);
    try {
      await signOut(auth);
    } catch {}
    setUser(null);
    setPendingPasswordUser(null);
    setHasPasswordProvider(false);
    setCounts({ unreadNotifications: 0, unreadMessages: 0 });
    showToast(`You have been signed out of ${brandName}`);
  };

  const updateProfile = async (data: Partial<User>, opts?: { silentToast?: boolean }) => {
    const res = await api.updateProfile(data);
    setUser(res.user);
    api.saveCachedMe(res.user);
    setSavedAccounts(upsertSavedAccountList(res.user, auth.currentUser?.email || res.user.email));
    if (!opts?.silentToast) {
      showToast('Profile updated');
    }
  };

  const deleteAccount = async () => {
    const fbUser = auth.currentUser;
    if (!fbUser) {
      throw new Error('You must be signed in to delete your account.');
    }

    const uid = fbUser.uid;
    await api.deleteAccount();

    try {
      await deleteUser(fbUser);
    } catch (err: any) {
      if (err?.code === 'auth/requires-recent-login') {
        try {
          await reauthenticateWithPopup(fbUser, googleProvider);
          await deleteUser(fbUser);
        } catch {
          await signOut(auth).catch(() => {});
        }
      } else {
        await signOut(auth).catch(() => {});
      }
    }

    clearRequirePasswordCheck(uid);
    setSavedAccounts(removeSavedAccountFromList(uid));
    activeUidRef.current = null;
    api.clearAccountSwitchCaches();
    seenNotifIdsRef.current.clear();
    initialNotifLoadRef.current = true;
    setAuthConfirmedUid(null);
    setUser(null);
    setPendingPasswordUser(null);
    setHasPasswordProvider(false);
    setCounts({ unreadNotifications: 0, unreadMessages: 0 });
    showToast('Your account has been permanently deleted.');
  };

  const openAuth = (tab: 'login' | 'register' = 'login') => {
    setAuthModalTab(tab);
    setAuthModalOpen(true);
  };

  const closeAuth = () => {
    setAuthModalOpen(false);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        pendingPasswordUser,
        loading,
        authConfirmedUid,
        storagePersistent,
        hasPasswordProvider,
        counts,
        brandName,
        setBrandName,
        signInWithGoogle,
        verifyAndUnlockPassword,
        resetPasswordViaGoogle,
        cancelPendingPasswordSignIn,
        setAccountPassword,
        removeAccountPassword,
        savedAccounts,
        accountSwitcherOpen,
        switchingAccountUid,
        openAccountSwitcher,
        closeAccountSwitcher,
        switchAccount,
        addNewAccount,
        removeSavedAccount,
        requestLogout,
        cancelLogout,
        confirmLogout,
        signOutConfirmOpen,
        logout: requestLogout,
        updateProfile,
        deleteAccount,
        refreshMe,
        authModalOpen,
        authModalTab,
        openAuth,
        closeAuth,
        activeToast,
        showToast,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
