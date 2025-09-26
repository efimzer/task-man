import { syncConfig } from './sync-config.js';

const DEFAULT_DEBOUNCE = 1500;

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
  const enabled = Boolean(
    syncConfig?.enabled && syncConfig.baseUrl && syncConfig.userId && typeof getState === 'function'
  );

  if (!enabled) {
    return {
      enabled: false,
      async pullInitial() {
        return false;
      },
      schedulePush() {},
      async forcePush() {
        return false;
      },
      getStatus() {
        return { enabled: false };
      }
    };
  }

  const baseUrl = normalizeBaseUrl(syncConfig.baseUrl);
  const debounceMs = Number.isFinite(syncConfig.pushDebounceMs)
    ? Math.max(250, syncConfig.pushDebounceMs)
    : DEFAULT_DEBOUNCE;

  const headers = { 'Content-Type': 'application/json' };
  if (syncConfig.authToken) {
    headers.Authorization = `Bearer ${syncConfig.authToken}`;
  }

  let pushTimer = null;
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

  async function pullInitial() {
    if (isPulling) {
      return false;
    }
    isPulling = true;
    setStatus({});

    try {
      const response = await fetch(`${baseUrl}/state/${encodeURIComponent(syncConfig.userId)}`, {
        headers
      });

      if (response.status === 404) {
        const current = getState();
        lastSyncedVersion = current?.meta?.version ?? null;
        return false;
      }

      if (!response.ok) {
        throw new Error(`Unexpected status ${response.status}`);
      }

      const remoteState = await response.json();
      if (remoteState?.meta?.version !== undefined) {
        lastSyncedVersion = remoteState.meta.version;
      }

      if (typeof applyRemoteState === 'function') {
        applyRemoteState(remoteState);
      }
      return true;
    } catch (error) {
      console.warn('Todo sync: unable to pull remote state', error);
      setStatus({ error });
      return false;
    } finally {
      isPulling = false;
      setStatus({});
    }
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
      const response = await fetch(`${baseUrl}/state/${encodeURIComponent(syncConfig.userId)}`, {
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
    schedulePush,
    forcePush,
    getStatus
  };
}
