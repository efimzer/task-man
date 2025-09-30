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

function buildHeaders({ token } = {}) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return headers;
}

export function createSyncManager({
  getState,
  applyRemoteState,
  onStatusChange,
  getAuthToken,
  onUnauthorized,
  useAuthCookies = false
} = {}) {
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
  const stateEndpoint = `${baseUrl}/state`;

  const parsedDebounce = Number(syncConfig.pushDebounceMs);
  const debounceMs = Number.isFinite(parsedDebounce) ? Math.max(50, parsedDebounce) : DEFAULT_DEBOUNCE;

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
  let pollTimer = null;
  let isPushing = false;
  let isPulling = false;
  let lastSyncedVersion = null;
  let lastError = null;

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

  function handleUnauthorized() {
    if (typeof onUnauthorized === 'function') {
      onUnauthorized();
    }
  }

  async function authorizedFetch(url, init = {}) {
    const token = typeof getAuthToken === 'function' ? getAuthToken() : undefined;
    const headers = buildHeaders({ token });
    if (init.headers) {
      const custom = new Headers(init.headers);
      custom.forEach((value, key) => headers.set(key, value));
    }
    const response = await fetch(url, {
      ...init,
      headers,
      credentials: 'include'
    });
    if (response.status === 401) {
      handleUnauthorized();
    }
    return response;
  }

  async function pullLatest({ skipIfUnchanged = false } = {}) {
    if (isPulling || isPushing) {
      return { applied: false, notFound: false, skipped: true };
    }
    isPulling = true;
    setStatus({});

    try {
      const response = await authorizedFetch(stateEndpoint);

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
      const response = await authorizedFetch(stateEndpoint, {
        method: 'PUT',
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
