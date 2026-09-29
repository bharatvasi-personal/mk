'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { drainQueue, enqueue, queueSize, type QueuedWrite } from './offline';

/**
 * Connectivity and the write queue, as one hook.
 *
 * `navigator.onLine` is not trusted on its own — a tablet joined to the shop Wi-Fi with
 * a dead uplink reports "online". The queue is therefore also drained on a timer and
 * after any request that fails at the network layer, and a successful drain is what
 * actually proves connectivity.
 */
export function useOfflineQueue() {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [dropped, setDropped] = useState<QueuedWrite[]>([]);
  const [draining, setDraining] = useState(false);

  const refreshCount = useCallback(async () => {
    try {
      setPending(await queueSize());
    } catch {
      /* IndexedDB unavailable (private mode) — the POS still works while online */
    }
  }, []);

  const drain = useCallback(async () => {
    if (draining) return;
    setDraining(true);
    try {
      const result = await drainQueue(
        async (w) => {
          await api(w.path, { method: w.method, body: w.body, idempotencyKey: w.idempotencyKey });
        },
        (remaining) => setPending(remaining),
      );
      if (result.dropped.length) setDropped((d) => [...d, ...result.dropped]);
      if (result.sent > 0 || result.failed === 0) setOnline(true);
      if (result.failed > 0) setOnline(false);
    } finally {
      setDraining(false);
      await refreshCount();
    }
  }, [draining, refreshCount]);

  useEffect(() => {
    void refreshCount();
    const onOnline = () => {
      setOnline(true);
      void drain();
    };
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    // Every 20 seconds regardless, because the browser's own signal is unreliable and a
    // queued bill that never syncs is a bill that never happened.
    const timer = setInterval(() => void drain(), 20_000);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Attempts a write immediately; on a network failure, queues it and reports success to
   * the caller so the counter can move on. A 4xx is a real rejection and is thrown.
   */
  const submit = useCallback(
    async <T>(
      path: string,
      body: unknown,
      idempotencyKey: string,
      label: string,
    ): Promise<{ result: T | null; queued: boolean }> => {
      try {
        const result = await api<T>(path, { method: 'POST', body, idempotencyKey });
        setOnline(true);
        return { result, queued: false };
      } catch (err) {
        const isRejection = err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 429;
        if (isRejection) throw err;
        await enqueue({ id: idempotencyKey, path, method: 'POST', body, idempotencyKey, label });
        setOnline(false);
        await refreshCount();
        return { result: null, queued: true };
      }
    },
    [refreshCount],
  );

  return { online, pending, dropped, draining, drain, submit, clearDropped: () => setDropped([]) };
}
