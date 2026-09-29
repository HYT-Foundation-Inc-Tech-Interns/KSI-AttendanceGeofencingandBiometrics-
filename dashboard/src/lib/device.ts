'use client';

/*
 * A stable identifier for this handset.
 *
 * Biometric enrollment is scoped per device, so the server needs something
 * that stays the same across visits. Without it, re-enrolling would create a
 * fresh row every time and the employee would accumulate duplicate
 * enrollments, each one another descriptor the matcher has to try.
 *
 * It is a random local value, not a fingerprint: nothing about the device is
 * read, so it carries no identifying information beyond "this browser
 * profile". Clearing site data simply makes the phone look new, which the
 * enrollment upsert handles.
 */

const STORAGE_KEY = 'klassic.deviceId';

/** Cached for the page's lifetime; localStorage is synchronous but not free. */
let cached: string | null = null;

export function getDeviceId(): string {
  if (cached) return cached;

  if (typeof window === 'undefined') {
    // Server render: no storage to read. Callers only use this in handlers.
    return 'web-unknown';
  }

  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing) {
      cached = existing;
      return existing;
    }

    const generated = `web-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
    window.localStorage.setItem(STORAGE_KEY, generated);
    cached = generated;
    return generated;
  } catch {
    /*
     * Private browsing can refuse localStorage. A per-session value still
     * works for this visit; the only cost is a duplicate enrollment row.
     */
    cached = `web-session-${Date.now().toString(36)}`;
    return cached;
  }
}
