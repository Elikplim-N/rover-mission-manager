import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { Download, RefreshCw, X } from 'lucide-react';

const INSTALL_DISMISSED_KEY = 'rover_pwa_install_dismissed';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Mounted once at the app shell. Handles two independent PWA concerns:
// offering an install-to-home-screen prompt, and applying a new build only
// when the operator chooses to (never mid-mission out from under them,
// since a forced reload would reset the in-memory mission-tracking refs
// in Mission Control).
export default function PWAManager() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installDismissed, setInstallDismissed] = useState(
    () => localStorage.getItem(INSTALL_DISMISSED_KEY) === '1'
  );
  const [needRefresh, setNeedRefresh] = useState(false);
  const [updateSW, setUpdateSW] = useState<((reload?: boolean) => Promise<void>) | null>(null);

  useEffect(() => {
    const update = registerSW({
      onNeedRefresh() {
        setNeedRefresh(true);
      },
      onOfflineReady() {
        // App shell is now cached; no internet connection is needed to open it.
      }
    });
    setUpdateSW(() => update);

    const handler = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const isStandalone =
    typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true);

  async function handleInstall() {
    if (!installEvent) return;
    await installEvent.prompt();
    await installEvent.userChoice;
    setInstallEvent(null);
  }

  function dismissInstall() {
    localStorage.setItem(INSTALL_DISMISSED_KEY, '1');
    setInstallDismissed(true);
  }

  const showInstallBanner = installEvent && !installDismissed && !isStandalone;

  if (!showInstallBanner && !needRefresh) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-md space-y-2">
      {showInstallBanner && (
        <div className="bg-gray-900 dark:bg-gray-800 text-white rounded-xl shadow-lg p-3.5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
            <Download className="w-4.5 h-4.5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold">Install Rover Mission Manager</p>
            <p className="text-[11px] text-gray-300">Add to your home screen to launch it like an app, no internet needed.</p>
          </div>
          <button
            onClick={handleInstall}
            className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shrink-0"
          >
            Install
          </button>
          <button onClick={dismissInstall} className="text-gray-400 hover:text-white shrink-0" aria-label="Dismiss">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {needRefresh && (
        <div className="bg-blue-600 text-white rounded-xl shadow-lg p-3.5 flex items-center gap-3">
          <RefreshCw className="w-4 h-4 shrink-0" />
          <p className="text-xs flex-1">A new version is ready.</p>
          <button
            onClick={() => updateSW?.(true)}
            className="bg-white text-blue-700 text-xs font-semibold px-3 py-1.5 rounded-lg shrink-0"
          >
            Restart
          </button>
          <button onClick={() => setNeedRefresh(false)} className="text-blue-200 hover:text-white shrink-0" aria-label="Dismiss">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
