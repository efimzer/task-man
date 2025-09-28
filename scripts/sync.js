import { syncConfig } from './sync-config.js';

const DEFAULT_DEBOUNCE = 1500;
const DEFAULT_PULL_INTERVAL = 2500;
const MIN_POLL_INTERVAL = 500;

function normalizeBaseUrl(value) {
  if (!value) {
    return '';
  }
  return value.replace(/\/?$/, '');
}

function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

export function createSyncManager({ getState, applyRemoteState, onStatusChange } = {}) {
  const enabled = Boolean(syncConfig?.enabled && syncConfig.baseUrl && typeof getState === 'function');

  if (!enabled) {
    return {
      enabled: false,
      async pullInitial() {
        return { applied: false, notFound: false, skipped: true };
      },
      async pullLatest() {
        return { applied: false, notFound: false, skipped: true };
      },
      schedulePush() {},
      async forcePush() {
        return false;
      },
      startPolling() {},
      stopPolling() {},
      getStatus() {
        return { enabled: false };
      }
    };
  }

  const baseUrl = normalizeBaseUrl(syncConfig.baseUrl);
  const parsedDebounce = Number(syncConfig.pushDebounceMs);
  const debounceMs = Number.isFinite(parsedDebounce) ? Math.max(50, parsedDebounce) : DEFAULT_DEBOUNCE;

  let includeCredentials = Boolean(syncConfig.useSessionAuth);
  if (!includeCredentials && typeof window !== 'undefined' && baseUrl) {
    try {
      const target = new URL(baseUrl, window.location.origin);
      includeCredentials = target.origin === window.location.origin;
    } catch (error) {
      includeCredentials = false;
    }
  }

  const headers = { 'Content-Type': 'application/json' };
  if (syncConfig.sessionCredentials?.email) {
    const raw = `${syncConfig.sessionCredentials.email}:${syncConfig.sessionCredentials.password ?? ''}`;
    headers.Authorization = `Basic ${btoa(raw)}`;
  } else if (syncConfig.authToken) {
    headers.Authorization = `Bearer ${syncConfig.authToken}`;
  }

  const tokenQuery = syncConfig.authToken && syncConfig.authTokenInQuery
    ? `token=${encodeURIComponent(syncConfig.authToken)}`
    : '';

  const stateUrl = () => {
    const effectiveUserId = syncConfig.userId || 'shared';
    const path = `${baseUrl}/state/${encodeURIComponent(effectiveUserId)}`;
    if (!tokenQuery) {
      return path;
    }
    return path.includes('?') ? `${path}&${tokenQuery}` : `${path}?${tokenQuery}`;
  };

  let pollInterval = null;
  if (syncConfig?.pullIntervalMs === undefined || syncConfig?.pullIntervalMs === null) {
    pollInterval = DEFAULT_PULL_INTERVAL;
  } else {
    const parsed = Number(syncConfig.pullIntervalMs);
    if (Number.isFinite(parsed)) {
      pollInterval = parsed > 0 ? Math.max(MIN_POLL_INTERVAL, parsed) : null;
    } else {
      pollInterval = DEFAULT_PULL_INTERVAL;
    }
  }

  let pushTimer = null;
  let isPushing = false;
  let isPulling = false;
  let lastSyncedVersion = null;
  let lastError = null;
  let pollTimer = null;
  let loginPromise = null;
  let isAuthenticated = false;

  async function ensureAuthenticated() {
    if (!includeCredentials) {
      return;
    }
    if (!syncConfig.sessionCredentials?.email || !syncConfig.sessionCredentials?.password) {
      return;
    }
    if (isAuthenticated) {
      return;
    }
    if (loginPromise) {
      return loginPromise;
    }

    const payload = {
      email: syncConfig.sessionCredentials.email,
      password: syncConfig.sessionCredentials.password
    };

    loginPromise = fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Auth failed (${response.status})`);
        }
        isAuthenticated = true;
      })
      .catch((error) => {
        console.warn('Todo sync: auth error', error);
        throw error;
      })
      .finally(() => {
        loginPromise = null;
      });

    return loginPromise;
  }

  async function fetchWithAuth(input, init = {}, { retryOnUnauthorized = true } = {}) {
    if (includeCredentials) {
      await ensureAuthenticated();
    }

    const response = await fetch(input, {
      ...init,
      credentials: includeCredentials ? 'include' : init.credentials
    });

    if (response.status === 401 && retryOnUnauthorized && includeCredentials) {
      isAuthenticated = false;
      await ensureAuthenticated();
      return fetchWithAuth(input, init, { retryOnUnauthorized: false });
    }

    return response;
  }

  function setStatus(status) {
    lastError = status?.error ?? null;
    if (typeof onStatusChange === 'function') {
      onStatusChange({
        enabled: true,
        isPushing,
        isPulling,
        lastSyncedVersion,
        error: lastError ?? undefined
      });
    }
  }

  async function pullLatest({ skipIfUnchanged = false } = {}) {
    if (isPulling || isPushing) {
      return { applied: false, notFound: false, skipped: true };
    }
    isPulling = true;
    setStatus({});

    try {
      const response = await fetchWithAuth(stateUrl(), { headers });

      if (response.status === 404) {
        const current = typeof getState === 'function' ? getState() : null;
        lastSyncedVersion = current?.meta?.version ?? null;
        return { applied: false, notFound: true };
      }

      if (!response.ok) {
        throw new Error(`Unexpected status ${response.status}`);
      }

      const remoteState = await response.json();
      const remoteVersion = remoteState?.meta?.version ?? null;
      const previousVersion = lastSyncedVersion;
      const localVersion = typeof getState === 'function' ? getState()?.meta?.version ?? null : null;

      if (remoteVersion !== null && remoteVersion !== undefined) {
        lastSyncedVersion = remoteVersion;
      }

      if (
        remoteVersion !== null &&
        localVersion !== null &&
        remoteVersion < localVersion
      ) {
        return { applied: false, notFound: false, skipped: true };
      }

      if (
        skipIfUnchanged &&
        remoteVersion !== null &&
        previousVersion !== null &&
        remoteVersion === previousVersion
      ) {
        return { applied: false, notFound: false };
      }

      if (typeof applyRemoteState === 'function') {
        applyRemoteState(remoteState);
      }

      return { applied: true, notFound: false };
    } catch (error) {
      console.warn('Todo sync: unable to pull remote state', error);
      setStatus({ error });
      return { applied: false, notFound: false, error };
    } finally {
      isPulling = false;
      setStatus({});
    }
  }

  async function pullInitial() {
    return pullLatest({ skipIfUnchanged: false });
  }

  async function pushState({ force = false } = {}) {
    if (isPushing) {
      return false;
    }

    const currentState = getState();
    const currentVersion = currentState?.meta?.version ?? null;

    if (!force && currentVersion !== null && currentVersion === lastSyncedVersion) {
      return false;
    }

    const payload = cloneState(currentState);

    isPushing = true;
    setStatus({});

    try {
      const response = await fetchWithAuth(stateUrl(), {
        method: 'PUT',
        headers,
        body: JSON.stringify({ state: payload })
      });

      if (!response.ok) {
        throw new Error(`Unexpected status ${response.status}`);
      }

      const result = await response.json();
      const syncedVersion = result?.meta?.version ?? currentVersion;
      lastSyncedVersion = syncedVersion ?? currentVersion;
      setStatus({});
      return true;
    } catch (error) {
      console.warn('Todo sync: unable to push remote state', error);
      setStatus({ error });
      return false;
    } finally {
      isPushing = false;
    }
  }

  function schedulePush() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      pushState().catch((error) => {
        console.warn('Todo sync: deferred push failed', error);
      });
    }, debounceMs);
  }

  async function forcePush() {
    clearTimeout(pushTimer);
    return pushState({ force: true });
  }

  function startPolling() {
    if (pollTimer || !pollInterval) {
      return;
    }

    pollTimer = setInterval(() => {
      pullLatest({ skipIfUnchanged: true }).catch((error) => {
        console.warn('Todo sync: polling pull failed', error);
      });
    }, pollInterval);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function getStatus() {
    return {
      enabled: true,
      isPulling,
      isPushing,
      lastSyncedVersion,
      error: lastError ?? undefined
    };
  }

  return {
    enabled: true,
    pullInitial,
    pullLatest,
    schedulePush,
    forcePush,
    startPolling,
    stopPolling,
    getStatus
  };
}
