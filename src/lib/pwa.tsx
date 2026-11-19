import React, { useEffect, useState } from 'react';
import { Download, WifiOff } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(isStandalone);

    const ua = window.navigator.userAgent.toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(ua));

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = async () => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredPrompt(null);
      return true;
    }
    return false;
  };

  return {
    isInstallable: Boolean(deferredPrompt),
    isInstalled,
    isIOS,
    install,
  };
}

export function PWAInstallButton({ compact = false }: { compact?: boolean }) {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) return null;

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="inline-flex items-center gap-2 rounded-lg border border-[#D8CEB8] dark:border-[#2C3731] bg-white dark:bg-[#1B231F] px-3 py-2 text-xs font-medium text-[#121513] dark:text-[#F4F1EA] hover:bg-[#F3EFE6] dark:hover:bg-[#232D28] transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
      >
        <Download className="w-4 h-4 text-[#064E3B] dark:text-[#10B981]" />
        <span>{compact ? 'Install' : 'Install App'}</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="inline-flex items-center gap-2 rounded-lg border border-[#D8CEB8] dark:border-[#2C3731] bg-white dark:bg-[#1B231F] px-3 py-2 text-xs font-medium text-[#121513] dark:text-[#F4F1EA] hover:bg-[#F3EFE6] dark:hover:bg-[#232D28] transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
        >
          <Download className="w-4 h-4 text-[#064E3B] dark:text-[#10B981]" />
          <span>Install on iOS</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="w-full max-w-sm rounded-2xl border border-[#E5DEC9] dark:border-[#26302B] bg-[#FAF8F3] dark:bg-[#151B18] p-6 shadow-xl">
              <h3 className="font-display text-2xl text-[#121513] dark:text-[#F4F1EA]">
                Add Tallymark to Home Screen
              </h3>
              <ol className="mt-3 space-y-2 text-sm text-[#5C635D] dark:text-[#9BA39D] list-decimal list-inside">
                <li>
                  Tap the <strong className="text-[#121513] dark:text-[#F4F1EA]">Share</strong> icon in Safari.
                </li>
                <li>
                  Scroll down and tap <strong className="text-[#121513] dark:text-[#F4F1EA]">Add to Home Screen</strong>.
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full rounded-lg bg-[#064E3B] text-white py-2.5 text-sm font-medium hover:bg-[#04392B] transition-colors min-h-[44px]"
              >
                Got it
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
}

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  return isOnline;
}

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div
      role="status"
      className="no-print fixed bottom-20 md:bottom-5 left-4 z-50 flex items-center gap-2 rounded-lg border border-amber-700/30 bg-amber-950/95 px-3.5 py-2 text-xs font-medium text-amber-100 shadow-lg"
    >
      <WifiOff className="w-3.5 h-3.5 text-amber-300" />
      <span>Offline — drafts stay saved on this device</span>
    </div>
  );
}
