import { MongoClient } from 'mongodb';

const DB_NAME = 'todo_app';

export async function initializeDatabase({ mongoUri, sessionTtl }) {
  console.log('🔄 Connecting to MongoDB...');
  const client = new MongoClient(mongoUri);
  await client.connect();

  const db = client.db(DB_NAME);
  const users = db.collection('users');
  const sessions = db.collection('sessions');
  const states = db.collection('states');

  await Promise.all([
    users.createIndex({ email: 1 }, { unique: true }),
    sessions.createIndex({ token: 1 }, { unique: true }),
    sessions.createIndex({ email: 1 }),
    states.createIndex({ email: 1 }, { unique: true }),
    maybeCreateSessionTtlIndex(sessions, sessionTtl)
  ]);

  console.log('✅ Connected to MongoDB successfully');

  return {
    client,
    db,
    collections: {
      users,
      sessions,
      states
    }
  };
}

async function maybeCreateSessionTtlIndex(collection, sessionTtl) {
  if (!sessionTtl) {
    return;
  }
  const expireAfterSeconds = Math.max(1, Math.floor(sessionTtl / 1000));
  await collection.createIndex(
    { createdAt: 1 },
    { expireAfterSeconds }
  );
}
