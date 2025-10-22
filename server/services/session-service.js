import { randomBytes } from 'node:crypto';

export function createSessionService({ collection, sessionTtl }) {
  const ttlMs = Number.isFinite(sessionTtl) && sessionTtl > 0 ? sessionTtl : null;

  async function issue(email) {
    const token = randomBytes(32).toString('hex');
    await collection.insertOne({
      token,
      email,
      createdAt: new Date()
    });
    return token;
  }

  async function findValidByToken(token) {
    if (!token) {
      return null;
    }
    const session = await collection.findOne({ token });
    if (!session) {
      return null;
    }

    if (ttlMs) {
      const age = Date.now() - session.createdAt.getTime();
      if (age > ttlMs) {
        await collection.deleteOne({ token });
        return null;
      }
    }

    return session;
  }

  async function revoke(token) {
    if (!token) {
      return;
    }
    await collection.deleteOne({ token });
  }

  async function cleanupExpiredSessions() {
    if (!ttlMs) {
      return { deletedCount: 0 };
    }
    const expiredBefore = new Date(Date.now() - ttlMs);
    const result = await collection.deleteMany({ createdAt: { $lt: expiredBefore } });
    return { deletedCount: result.deletedCount ?? 0 };
  }

  async function listByEmail(email) {
    if (!email) {
      return [];
    }
    return collection.find({ email }).toArray();
  }

  async function count() {
    return collection.countDocuments();
  }

  return {
    issue,
    findValidByToken,
    revoke,
    cleanupExpiredSessions,
    listByEmail,
    count
  };
}
