import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Register PWA service worker only in production; clear stale dev caches automatically
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    if (import.meta.env.PROD) {
      navigator.serviceWorker
        .register('/sw.js', { updateViaCache: 'none' })
        .catch(() => {});
    } else {
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => {
          registrations.forEach((reg) => reg.unregister());
        })
        .catch(() => {});
      if ('caches' in window) {
        caches
          .keys()
          .then((keys) => keys.forEach((k) => caches.delete(k)))
          .catch(() => {});
      }
    }
  });
}

createRoot(document.getElementById('root')!).render(<App />);
