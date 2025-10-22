import { Router } from 'express';

export function createStateRouter({ authHelpers, stateService }) {
  const router = Router();

  router.get('/state', authHelpers.requireAuth, asyncHandler(async (req, res) => {
    const email = req.auth.email;
    const state = await stateService.getOrCreateState(email);
    res.json(state);
  }));

  router.put('/state', authHelpers.requireAuth, asyncHandler(async (req, res) => {
    const email = req.auth.email;
    const payload = req.body?.state;

    if (!payload || typeof payload !== 'object') {
      console.log(`[STATE UPDATE ERROR] Invalid state from ${email}`);
      res.status(400).json({ error: 'INVALID_STATE' });
      return;
    }

    console.log(`[STATE UPDATE] Updating state for ${email}, folders: ${payload.folders?.length || 0}, tasks: ${payload.tasks?.length || 0}`);

    await stateService.upsertState(email, payload);

    console.log(`[STATE UPDATE SUCCESS] State saved for ${email}`);

    res.json({ ok: true, meta: payload.meta ?? null });
  }));

  return router;
}

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch((error) => {
      console.error('[STATE ROUTE ERROR]', error);
      next(error);
    });
  };
}
