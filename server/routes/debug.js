import { Router } from 'express';
import { normalizeEmail } from '../utils/validation.js';

export function createDebugRouter({ userService, sessionService, stateService }) {
  const router = Router();

  router.get('/api/debug/stats', asyncHandler(async (req, res) => {
    const [users, sessions, states, userEmails, stateEmails] = await Promise.all([
      userService.count(),
      sessionService.count(),
      stateService.count(),
      userService.listEmails(),
      stateService.listEmails()
    ]);

    res.json({
      users,
      sessions,
      states,
      userEmails,
      stateEmails
    });
  }));

  router.get('/api/debug/user/:email', asyncHandler(async (req, res) => {
    const email = normalizeEmail(req.params.email);
    const user = await userService.findByEmail(email, { projection: { hash: 0, salt: 0 } });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const [stateDoc, sessions] = await Promise.all([
      stateService.findRawState(email),
      sessionService.listByEmail(email)
    ]);

    res.json({
      email: user.email,
      createdAt: user.createdAt ? new Date(user.createdAt).toISOString() : null,
      activeSessions: sessions.length,
      sessions: sessions.map((session) => ({
        token: `${session.token.substring(0, 8)}...`,
        createdAt: session.createdAt.toISOString()
      })),
      state: {
        folders: stateDoc?.folders?.length || 0,
        tasks: stateDoc?.tasks?.length || 0,
        archivedTasks: Array.isArray(stateDoc?.archivedTasks) ? stateDoc.archivedTasks.length : 0,
        completedTasks: Array.isArray(stateDoc?.tasks)
          ? stateDoc.tasks.filter((task) => task?.completed).length
          : 0,
        lastUpdate: stateDoc?.meta?.updatedAt ? new Date(stateDoc.meta.updatedAt).toISOString() : null
      }
    });
  }));

  return router;
}

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch((error) => {
      console.error('[DEBUG ROUTE ERROR]', error);
      next(error);
    });
  };
}
