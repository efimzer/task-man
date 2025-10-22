import { createDefaultState, normalizeState, cloneState } from '../../shared/state.js';

export function createStateService(collection) {
  async function getOrCreateState(email) {
    if (!email) {
      return createDefaultState();
    }

    const existing = await collection.findOne({ email });
    if (!existing) {
      const defaultState = createDefaultState();
      await collection.insertOne({ email, ...defaultState });
      return defaultState;
    }

    const { _id, email: _ignored, ...stateData } = existing;
    return normalizeState(stateData);
  }

  async function ensureInitialized(email) {
    await collection.updateOne(
      { email },
      { $setOnInsert: { ...createDefaultState(), email } },
      { upsert: true }
    );
  }

  async function upsertState(email, state) {
    if (!email) {
      throw new Error('Email is required to persist state');
    }
    const payload = cloneState(state);
    await collection.updateOne(
      { email },
      { $set: { ...payload, email } },
      { upsert: true }
    );
  }

  async function count() {
    return collection.countDocuments();
  }

  async function listEmails() {
    const states = await collection.find({}, { projection: { email: 1, _id: 0 } }).toArray();
    return states.map((entry) => entry.email);
  }

  async function findRawState(email) {
    if (!email) {
      return null;
    }
    return collection.findOne({ email });
  }

  return {
    getOrCreateState,
    ensureInitialized,
    upsertState,
    count,
    listEmails,
    findRawState
  };
}
