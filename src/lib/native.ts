import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { StatusBar, Style } from '@capacitor/status-bar';

export class NativeBridge {
  private static isInitialized = false;

  static async init() {
    if (this.isInitialized || typeof window === 'undefined') return;
    this.isInitialized = true;

    try {
      // Configure dark status bar to blend seamlessly into OLED dark design
      await StatusBar.setStyle({ style: Style.Dark });
      await StatusBar.setBackgroundColor({ color: '#09090b' });
      await StatusBar.setOverlaysWebView({ overlay: false });
    } catch {
      // Not running inside native mobile webview container, graceful fallback
    }
  }

  // Tactile haptic feedback for user interactions (likes, buttons, tabs)
  static async triggerHaptic(type: 'light' | 'medium' | 'heavy' | 'selection' | 'success' | 'warning' = 'light') {
    try {
      if (type === 'selection') {
        await Haptics.selectionStart();
        await Haptics.selectionChanged();
        return;
      }

      if (type === 'success') {
        await Haptics.notification({ type: NotificationType.Success });
        return;
      }

      if (type === 'warning') {
        await Haptics.notification({ type: NotificationType.Warning });
        return;
      }

      const style =
        type === 'heavy'
          ? ImpactStyle.Heavy
          : type === 'medium'
          ? ImpactStyle.Medium
          : ImpactStyle.Light;

      await Haptics.impact({ style });
    } catch {
      // Browser fallback using Web Vibration API if supported
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        if (type === 'light' || type === 'selection') navigator.vibrate(10);
        else if (type === 'medium') navigator.vibrate(25);
        else if (type === 'heavy') navigator.vibrate(50);
        else if (type === 'success') navigator.vibrate([15, 50, 15]);
      }
    }
  }
}
