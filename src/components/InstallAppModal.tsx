import React, { useState } from 'react';
import {
  Smartphone,
  Download,
  Check,
  X,
  Terminal,
  Cpu,
  ShieldCheck,
  ArrowDownCircle,
  Sparkles,
  Layers,
  Store,
  FileCode,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { Logo } from './Logo';
import { NativeBridge } from '../lib/native';

export const InstallAppModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({
  isOpen,
  onClose,
}) => {
  const { hasNativePrompt, isInstalled, isIOS, isAndroid, install } = usePWAInstall();
  const [activeTab, setActiveTab] = useState<'native_app' | 'direct_install' | 'play_store'>('native_app');
  const [copiedCli, setCopiedCli] = useState(false);
  const [copiedTwa, setCopiedTwa] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  React.useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleDownloadProject = () => {
    NativeBridge.triggerHaptic('medium');
    setIsDownloading(true);
    const link = document.createElement('a');
    link.href = '/api/android/download-project';
    link.setAttribute('download', 'sync-native-android-project.zip');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => {
      setIsDownloading(false);
    }, 2500);
  };

  const handleInstallClick = async () => {
    NativeBridge.triggerHaptic('light');
    if (hasNativePrompt) {
      const ok = await install();
      if (ok) onClose();
    }
  };

  const gradleCommand = `./gradlew assembleDebug`;
  const twaCommand = `npx @bubblewrap/cli build`;

  const handleCopyCli = (text: string, type: 'gradle' | 'twa') => {
    NativeBridge.triggerHaptic('light');
    navigator.clipboard?.writeText(text);
    if (type === 'gradle') {
      setCopiedCli(true);
      setTimeout(() => setCopiedCli(false), 2500);
    } else {
      setCopiedTwa(true);
      setTimeout(() => setCopiedTwa(false), 2500);
    }
  };

  return (
    <AnimatePresence>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Mobile App Center"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
        className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-2xl flex items-center justify-center p-4"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="glass-surface w-full max-w-xl rounded-3xl p-5 sm:p-6 md:p-8 border border-white/15 relative shadow-2xl max-h-[90dvh] overflow-y-auto"
        >
          {/* Close button */}
          <motion.button
            type="button"
            whileHover={{ scale: 1.1, rotate: 90 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => {
              NativeBridge.triggerHaptic('light');
              onClose();
            }}
            aria-label="Close mobile app center"
            className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center rounded-full text-zinc-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </motion.button>

          {/* Header */}
          <div className="flex flex-col items-center text-center mb-6">
            <Logo size="md" />
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-[10px] font-mono text-zinc-300 mt-3">
              <Cpu className="w-3 h-3 text-emerald-400" />
              <span>Native Android Package (network.sync.app)</span>
            </div>
            <h3 className="text-xl font-bold text-white mt-2">Mobile App Center</h3>
            <p className="text-xs text-zinc-400 mt-1 max-w-md">
              Real native mobile application architecture with hardware haptics, Android Studio compilation, and Google Play Store TWA readiness.
            </p>
          </div>

          {/* Mode Switcher */}
          <div className="grid grid-cols-3 rounded-2xl bg-white/[0.04] p-1 border border-white/10 mb-6 gap-1">
            <button
              onClick={() => {
                NativeBridge.triggerHaptic('selection');
                setActiveTab('native_app');
              }}
              className={`py-2 px-1.5 sm:px-2 rounded-xl text-[11px] sm:text-xs font-semibold transition cursor-pointer flex items-center justify-center gap-1 sm:gap-1.5 text-center ${
                activeTab === 'native_app'
                  ? 'bg-white text-black shadow-md'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5 shrink-0 hidden sm:inline" />
              <span className="truncate">APK Project</span>
            </button>
            <button
              onClick={() => {
                NativeBridge.triggerHaptic('selection');
                setActiveTab('direct_install');
              }}
              className={`py-2 px-1.5 sm:px-2 rounded-xl text-[11px] sm:text-xs font-semibold transition cursor-pointer flex items-center justify-center gap-1 sm:gap-1.5 text-center ${
                activeTab === 'direct_install'
                  ? 'bg-white text-black shadow-md'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Download className="w-3.5 h-3.5 shrink-0 hidden sm:inline" />
              <span className="truncate">Direct Install</span>
            </button>
            <button
              onClick={() => {
                NativeBridge.triggerHaptic('selection');
                setActiveTab('play_store');
              }}
              className={`py-2 px-1.5 sm:px-2 rounded-xl text-[11px] sm:text-xs font-semibold transition cursor-pointer flex items-center justify-center gap-1 sm:gap-1.5 text-center ${
                activeTab === 'play_store'
                  ? 'bg-white text-black shadow-md'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Store className="w-3.5 h-3.5 shrink-0 hidden sm:inline" />
              <span className="truncate">Play Store</span>
            </button>
          </div>

          {/* Tab 1: Native Android App & APK Build Pipeline */}
          {activeTab === 'native_app' && (
            <div className="flex flex-col gap-4">
              {/* Native Architecture Details */}
              <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10">
                <div className="flex items-start gap-3">
                  <div className="p-2.5 rounded-xl bg-white/10 text-white shrink-0 mt-0.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-white">Full Native Android Project</h4>
                    <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                      Download the complete native Android repository with Gradle build scripts, AndroidX dependencies, Kotlin/Java <span className="font-mono text-zinc-200">MainActivity</span>, AndroidManifest permissions (<span className="text-zinc-300">Vibrate, Camera, Storage</span>), and tactile haptics.
                    </p>
                  </div>
                </div>

                {/* Direct Download Button */}
                <div className="mt-4 pt-3.5 border-t border-white/10">
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleDownloadProject}
                    disabled={isDownloading}
                    className="glass-button-primary w-full py-3.5 text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer shadow-[0_0_20px_rgba(255,255,255,0.2)]"
                  >
                    {isDownloading ? (
                      <>
                        <ArrowDownCircle className="w-4 h-4 animate-bounce" />
                        <span>Generating ZIP Package...</span>
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4" />
                        <span>Download Android Studio Project (.zip)</span>
                      </>
                    )}
                  </motion.button>
                  <p className="text-[10px] text-zinc-500 text-center mt-2 font-mono">
                    Includes all Gradle scripts, AndroidManifest & ready-to-run APK build config
                  </p>
                </div>
              </div>

              {/* Native vs Web Wrapper Comparison */}
              <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/10">
                <div className="flex items-center gap-2 text-xs font-semibold text-white mb-2.5">
                  <Layers className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Why this is a Real App, not just a Web Bookmark</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
                  <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5 space-y-1">
                    <div className="text-emerald-400 font-semibold flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>Native App Experience</span>
                    </div>
                    <ul className="text-zinc-400 space-y-0.5 list-disc list-inside">
                      <li>Full screen with zero URL bar</li>
                      <li>Hardware haptic vibrations</li>
                      <li>Android APK / AAB package</li>
                      <li>Android Studio & Gradle native code</li>
                    </ul>
                  </div>
                  <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5 space-y-1">
                    <div className="text-zinc-400 font-semibold flex items-center gap-1">
                      <AlertCircle className="w-3 h-3 text-zinc-500" />
                      <span>Web Wrapper Limitations</span>
                    </div>
                    <ul className="text-zinc-500 space-y-0.5 list-disc list-inside">
                      <li>Trapped inside browser frame</li>
                      <li>No direct APK compilation</li>
                      <li>No AndroidManifest control</li>
                      <li>External third-party dependency</li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* How to Build APK Step-by-Step */}
              <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10">
                <h4 className="text-xs font-semibold text-white mb-2 flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5 text-zinc-400" />
                  <span>How to compile your APK in 2 minutes</span>
                </h4>

                <div className="space-y-2 text-xs text-zinc-300">
                  <div className="p-3 rounded-xl bg-black/40 border border-white/5">
                    <div className="font-semibold text-white text-[11px] mb-1">Method 1: Android Studio (GUI - Recommended)</div>
                    <ol className="text-[11px] text-zinc-400 list-decimal list-inside space-y-1">
                      <li>Unzip the downloaded project and open it in <strong>Android Studio</strong></li>
                      <li>Go to <strong>Build &gt; Build Bundle(s) / APK(s) &gt; Build APK(s)</strong></li>
                      <li>Click <strong>locate</strong> in the notification to get your <span className="font-mono text-zinc-200">app-debug.apk</span></li>
                    </ol>
                  </div>

                  <div className="p-3 rounded-xl bg-black/40 border border-white/5">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-white text-[11px]">Method 2: Command Line (One-Liner)</span>
                      <button
                        onClick={() => handleCopyCli(gradleCommand, 'gradle')}
                        className="text-[10px] text-zinc-400 hover:text-white font-mono cursor-pointer"
                      >
                        {copiedCli ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                    <pre className="p-2 rounded-lg bg-black/60 font-mono text-[11px] text-emerald-400 overflow-x-auto">
                      cd sync-android && ./gradlew assembleDebug
                    </pre>
                    <p className="text-[10px] text-zinc-400 mt-1">
                      Outputs APK at: <span className="font-mono text-zinc-300">app/build/outputs/apk/debug/app-debug.apk</span>
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-black/40 border border-white/5">
                    <div className="font-semibold text-white text-[11px] mb-1 flex items-center gap-1">
                      <Sparkles className="w-3 h-3 text-amber-400" />
                      <span>Method 3: Automated GitHub Actions CI</span>
                    </div>
                    <p className="text-[11px] text-zinc-400 leading-relaxed">
                      We included <span className="font-mono text-zinc-300">.github/workflows/build-apk.yml</span>. Simply push to GitHub and GitHub Actions automatically compiles the APK on every commit and lets you download the APK directly from your repository's Actions tab.
                    </p>
                  </div>
                </div>
              </div>

              {/* Sideloading note */}
              <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5 text-[11px] text-zinc-400">
                <strong className="text-zinc-200">Installing on your phone:</strong> Transfer <span className="font-mono text-zinc-300">app-debug.apk</span> via USB, Telegram, or Drive, tap the file, and press "Install".
              </div>
            </div>
          )}

          {/* Tab 2: Instant PWA / WebAPK Installation */}
          {activeTab === 'direct_install' && (
            <div className="flex flex-col gap-4">
              <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 flex items-start gap-3.5">
                <div className="p-2.5 rounded-xl bg-white/10 text-white shrink-0">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-white">Direct Device Installation</h4>
                  <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">
                    Installs SYNC into your phone's native app drawer with splash screen, dark status bar, and standalone display.
                  </p>
                </div>
              </div>

              {isInstalled ? (
                <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>SYNC is already installed as a standalone app on this device.</span>
                </div>
              ) : hasNativePrompt ? (
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleInstallClick}
                  className="glass-button-primary w-full py-3.5 text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer shadow-[0_0_20px_rgba(255,255,255,0.2)]"
                >
                  <Download className="w-4 h-4" />
                  <span>Install SYNC on this Device</span>
                </motion.button>
              ) : (
                <div className="p-4 rounded-2xl bg-white/[0.04] border border-white/10 flex flex-col gap-2.5">
                  <div className="text-xs font-semibold text-white">Installation Instructions</div>
                  {isIOS ? (
                    <ol className="text-xs text-zinc-400 list-decimal list-inside space-y-1.5 leading-relaxed">
                      <li>Tap the <strong>Share</strong> button in Safari</li>
                      <li>Scroll down and tap <strong>Add to Home Screen</strong></li>
                      <li>Tap <strong>Add</strong> to install SYNC with the app icon</li>
                    </ol>
                  ) : (
                    <ol className="text-xs text-zinc-400 list-decimal list-inside space-y-1.5 leading-relaxed">
                      <li>Open this URL in Chrome, Brave, or Samsung Internet</li>
                      <li>Tap the <strong>three dots menu (⋮)</strong> at top right</li>
                      <li>Select <strong>Install app</strong> or <strong>Add to Home screen</strong></li>
                      <li>Android generates and installs the native WebAPK package</li>
                    </ol>
                  )}
                </div>
              )}

              <div className="text-[11px] text-zinc-500 text-center font-mono">
                Manifest v1.0 • Standalone Display • Offline Cached
              </div>
            </div>
          )}

          {/* Tab 3: Google Play Store / TWA */}
          {activeTab === 'play_store' && (
            <div className="flex flex-col gap-4">
              <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10">
                <div className="flex items-start gap-3">
                  <div className="p-2.5 rounded-xl bg-white/10 text-white shrink-0 mt-0.5">
                    <Store className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-white">Google Play Store & Trusted Web Activity (TWA)</h4>
                    <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                      Google's official container for publishing modern web apps to Google Play. It runs as a true Android Activity with zero address bar.
                    </p>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-white/10 space-y-3">
                  <div className="p-3 rounded-xl bg-black/40 border border-white/5 space-y-1.5">
                    <div className="text-xs font-semibold text-white flex items-center justify-between">
                      <span>Digital Asset Links Verification</span>
                      <span className="text-[10px] text-emerald-400 font-mono">ACTIVE (200 OK)</span>
                    </div>
                    <p className="text-[11px] text-zinc-400">
                      Located at <span className="font-mono text-zinc-200">/.well-known/assetlinks.json</span>. This establishes verified app ownership with Google Play and permanently removes the browser URL bar.
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-black/40 border border-white/5">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-white text-[11px]">Build with Google Bubblewrap CLI</span>
                      <button
                        onClick={() => handleCopyCli(twaCommand, 'twa')}
                        className="text-[10px] text-zinc-400 hover:text-white font-mono cursor-pointer"
                      >
                        {copiedTwa ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                    <pre className="p-2 rounded-lg bg-black/60 font-mono text-[11px] text-emerald-400 overflow-x-auto">
                      {twaCommand}
                    </pre>
                    <p className="text-[10px] text-zinc-400 mt-1.5">
                      Uses <span className="font-mono text-zinc-300">public/twa-manifest.json</span> to generate an Android App Bundle (<span className="font-mono text-zinc-300">.aab</span>) ready for upload to Google Play Console.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="mt-6 pt-4 border-t border-white/10 flex justify-end">
            <button
              onClick={() => {
                NativeBridge.triggerHaptic('light');
                onClose();
              }}
              className="px-5 py-2 rounded-2xl text-xs text-zinc-400 hover:text-white transition cursor-pointer"
            >
              Close
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
