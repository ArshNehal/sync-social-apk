// Low-volume tactile audio synthesizer powered by Web Audio API
// Zero external asset downloads, instant <1ms response, mobile-safe auto-unlock

const SOUND_STORAGE_KEY = 'sync_sound_enabled';

let audioCtx: AudioContext | null = null;
let soundEnabled = (() => {
  try {
    const val = localStorage.getItem(SOUND_STORAGE_KEY);
    return val === null ? true : val !== 'false';
  } catch {
    return true;
  }
})();

const listeners = new Set<(enabled: boolean) => void>();
const lastPlayedAt: Record<string, number> = {};
let unlockBound = false;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    try {
      audioCtx = new Ctx();
    } catch {
      return null;
    }
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

export function bindAudioUnlock() {
  if (unlockBound || typeof window === 'undefined') return;
  unlockBound = true;
  const unlock = () => {
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    if (ctx && ctx.state === 'running') {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('touchstart', unlock);
      window.removeEventListener('keydown', unlock);
    }
  };
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('touchstart', unlock, { passive: true });
  window.addEventListener('keydown', unlock, { passive: true });
}

function shouldPlay(key: string, minIntervalMs: number): boolean {
  if (!soundEnabled) return false;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false;
  const now = Date.now();
  if (lastPlayedAt[key] && now - lastPlayedAt[key] < minIntervalMs) {
    return false;
  }
  lastPlayedAt[key] = now;
  return true;
}

function playTone(opts: {
  freqStart: number;
  freqEnd?: number;
  duration: number;
  gain: number;
  type?: OscillatorType;
  delay?: number;
}) {
  const ctx = getAudioContext();
  if (!ctx || ctx.state !== 'running') return;

  try {
    const startTime = ctx.currentTime + (opts.delay || 0);
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(opts.freqStart, startTime);
    if (opts.freqEnd && opts.freqEnd !== opts.freqStart) {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(40, opts.freqEnd),
        startTime + opts.duration
      );
    }

    // Ultra-soft attack & exponential fade-out so tones never click or clip
    gainNode.gain.setValueAtTime(0.0001, startTime);
    gainNode.gain.linearRampToValueAtTime(opts.gain, startTime + 0.006);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + opts.duration);

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc.start(startTime);
    osc.stop(startTime + opts.duration + 0.02);
  } catch {
    // Ignore transient audio context restrictions
  }
}

export const soundFX = {
  isEnabled: (): boolean => soundEnabled,

  setEnabled: (enabled: boolean) => {
    soundEnabled = enabled;
    try {
      localStorage.setItem(SOUND_STORAGE_KEY, String(enabled));
    } catch {}
    listeners.forEach((cb) => {
      try {
        cb(enabled);
      } catch {}
    });
    if (enabled) {
      bindAudioUnlock();
      soundFX.playTap();
    }
  },

  subscribe: (cb: (enabled: boolean) => void): (() => void) => {
    listeners.add(cb);
    cb(soundEnabled);
    return () => {
      listeners.delete(cb);
    };
  },

  // Subtle crystalline tap for mobile navigation & buttons
  playTap: () => {
    bindAudioUnlock();
    if (!shouldPlay('tap', 45)) return;
    playTone({ freqStart: 720, freqEnd: 480, duration: 0.028, gain: 0.018, type: 'sine' });
  },

  // Warm two-note rising glass chime on Like
  playLike: () => {
    bindAudioUnlock();
    if (!shouldPlay('like', 120)) return;
    playTone({ freqStart: 784, freqEnd: 880, duration: 0.065, gain: 0.026, type: 'sine' });
    playTone({ freqStart: 1174, freqEnd: 1318, duration: 0.11, gain: 0.028, type: 'sine', delay: 0.045 });
  },

  // Soft muted tick on Unlike
  playUnlike: () => {
    bindAudioUnlock();
    if (!shouldPlay('unlike', 120)) return;
    playTone({ freqStart: 420, freqEnd: 300, duration: 0.05, gain: 0.016, type: 'sine' });
  },

  // Clean ascending triad bloom for publishing / saving / copying
  playSuccess: () => {
    bindAudioUnlock();
    if (!shouldPlay('success', 200)) return;
    playTone({ freqStart: 587, duration: 0.08, gain: 0.024, type: 'sine' });
    playTone({ freqStart: 880, duration: 0.1, gain: 0.026, type: 'sine', delay: 0.05 });
    playTone({ freqStart: 1174, duration: 0.14, gain: 0.024, type: 'sine', delay: 0.1 });
  },

  // Refined Telegram/Apple-like upward pop when sending a message
  playMessageSent: () => {
    bindAudioUnlock();
    if (!shouldPlay('msg_sent', 100)) return;
    playTone({ freqStart: 440, freqEnd: 920, duration: 0.075, gain: 0.032, type: 'sine' });
    playTone({ freqStart: 1046, freqEnd: 1174, duration: 0.08, gain: 0.02, type: 'triangle', delay: 0.035 });
  },

  // Delicate two-tone crystalline droplet chime when receiving a message
  playMessageReceived: () => {
    bindAudioUnlock();
    if (!shouldPlay('msg_recv', 650)) return;
    playTone({ freqStart: 880, freqEnd: 932, duration: 0.09, gain: 0.036, type: 'sine' });
    playTone({ freqStart: 1318, freqEnd: 1396, duration: 0.16, gain: 0.034, type: 'sine', delay: 0.065 });
  },

  // Airy alert ping for live notifications
  playNotification: () => {
    bindAudioUnlock();
    if (!shouldPlay('notif', 700)) return;
    playTone({ freqStart: 1046, duration: 0.085, gain: 0.026, type: 'sine' });
    playTone({ freqStart: 1480, duration: 0.14, gain: 0.022, type: 'sine', delay: 0.06 });
  },
};
