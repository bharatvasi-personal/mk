'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker, and only on the staff surfaces.
 *
 * The public menu does not need one — it is server-rendered and cached at the edge
 * anyway — and registering a worker for casual visitors means their browser keeps a copy
 * of a site they looked at once. The counter, the kitchen screen and the punch board are
 * the pages that must survive a reload with no network.
 */
const STAFF_PREFIXES = ['/pos', '/kitchen', '/punch', '/admin'];

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const path = window.location.pathname;
    // Paths are /<locale>/<section>, so the locale segment is dropped before matching.
    const section = '/' + path.split('/').slice(2).join('/');
    if (!STAFF_PREFIXES.some((p) => section.startsWith(p))) return;

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });

        // A new deploy should not wait for every tab to close before taking effect —
        // the tablet at the counter is open from 7 am to 11 pm.
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              installing.postMessage('SKIP_WAITING');
            }
          });
        });
      } catch {
        // Registration failing is survivable: the app still works online, and the
        // IndexedDB write queue is independent of the worker.
      }
    };

    // After load, so registering never competes with the first paint on a slow tablet.
    if (document.readyState === 'complete') void register();
    else window.addEventListener('load', () => void register(), { once: true });
  }, []);

  return null;
}
