import React, { useEffect, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import type { PushStatusRecord } from '../../shared/v2/types';
import { v2Api } from '../api';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function PushNotificationsCard() {
  const [status, setStatus] = useState<PushStatusRecord | null>(null);
  const [browserSupported, setBrowserSupported] = useState(false);
  const [isSubscribedThisDevice, setIsSubscribedThisDevice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const supported =
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window;
    setBrowserSupported(supported);

    let active = true;
    const init = async () => {
      try {
        const res = await v2Api.getPushStatus();
        if (active) setStatus(res);
      } catch {
        // Ignore if push endpoint unavailable in direct static mode
      }
      if (supported) {
        try {
          const reg = await navigator.serviceWorker.getRegistration();
          const sub = reg ? await reg.pushManager.getSubscription() : null;
          if (active) setIsSubscribedThisDevice(Boolean(sub));
        } catch {
          // ignore
        }
      }
    };
    init();
    return () => {
      active = false;
    };
  }, []);

  const handleEnable = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (!browserSupported) {
        throw new Error('This browser does not support push alerts. Your in-app badge still works.');
      }
      if (!status?.vapidConfigured || !status.publicKey) {
        throw new Error('Push alerts are not configured on this server yet. Your in-app badge still works.');
      }

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        throw new Error('Alerts were not allowed in your browser. Your in-app badge will still show pending reports.');
      }

      let reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        reg = await navigator.serviceWorker.register('/push-sw.js');
      }
      await navigator.serviceWorker.ready;

      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(status.publicKey) as unknown as BufferSource,
      });

      const subJson = subscription.toJSON();
      if (!subJson.endpoint || !subJson.keys?.p256dh || !subJson.keys?.auth) {
        throw new Error('Unable to register device alert key.');
      }

      await v2Api.subscribePush({
        endpoint: subJson.endpoint,
        keys: {
          p256dh: subJson.keys.p256dh,
          auth: subJson.keys.auth,
        },
      });

      setIsSubscribedThisDevice(true);
      const updated = await v2Api.getPushStatus().catch(() => null);
      if (updated) setStatus(updated);
      setNotice('Payment report alerts turned on for this device.');
    } catch (err: any) {
      setError(err?.message || 'Unable to turn on push alerts');
    } finally {
      setBusy(false);
    }
  };

  const handleDisable = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        await v2Api.unsubscribePush(sub.endpoint).catch(() => {});
        await sub.unsubscribe().catch(() => {});
      }
      setIsSubscribedThisDevice(false);
      const updated = await v2Api.getPushStatus().catch(() => null);
      if (updated) setStatus(updated);
      setNotice('Push alerts turned off on this device. Your in-app badge remains active.');
    } catch (err: any) {
      setError(err?.message || 'Unable to turn off push alerts');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-5 sm:p-6 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-[10px] bg-[#F4F6F8] dark:bg-[#1A221F] text-[#064E3B] dark:text-[#6EE7B7] flex items-center justify-center shrink-0">
            {isSubscribedThisDevice ? <Bell className="w-5 h-5" /> : <BellOff className="w-5 h-5" />}
          </div>
          <div className="max-w-lg">
            <h2 className="text-base font-semibold">Payment Report Alerts (Opt-in)</h2>
            <p className="mt-0.5 text-xs text-[#6B7280] dark:text-[#9CA3AF]">
              Receive a short alert on this phone when a customer taps &ldquo;I&apos;ve paid&rdquo;. Alerts never include customer names or amounts. Even when off, pending reports show a badge inside Tallymark.
            </p>
          </div>
        </div>

        {isSubscribedThisDevice ? (
          <button
            type="button"
            disabled={busy}
            onClick={handleDisable}
            className="min-h-[44px] rounded-[10px] border border-gray-200 dark:border-[#232D29] px-4 py-2 text-xs font-semibold hover:bg-[#F4F6F8] dark:hover:bg-[#1A221F] disabled:opacity-60"
          >
            {busy ? 'Updating…' : 'Turn off alerts'}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy || !browserSupported || !status?.vapidConfigured}
            onClick={handleEnable}
            className="min-h-[44px] rounded-[10px] bg-[#064E3B] px-4 py-2 text-xs font-semibold text-white hover:bg-[#04392B] disabled:opacity-50"
          >
            {busy ? 'Enabling…' : 'Turn on alerts'}
          </button>
        )}
      </div>

      {!browserSupported && (
        <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">
          Your browser does not support Web Push alerts. Pending payment reports will still show as a badge in navigation.
        </p>
      )}
      {browserSupported && status && !status.vapidConfigured && (
        <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">
          Phone push keys are not configured on this server yet. In-app badge alerts remain active.
        </p>
      )}
      {notice && (
        <p className="text-xs font-medium text-[#064E3B] dark:text-[#6EE7B7]">{notice}</p>
      )}
      {error && <p className="text-xs text-[#B91C1C] dark:text-red-400">{error}</p>}
    </section>
  );
}
