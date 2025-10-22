import { extractTokenFromRequest } from '../utils/tokens.js';

export function createAuthHelpers({ sessionService, cookieName }) {
  async function resolveSession(req) {
    const token = extractTokenFromRequest(req, cookieName);
    if (!token) {
      return null;
    }
    const session = await sessionService.findValidByToken(token);
    if (!session) {
      return null;
    }
    return { token: session.token, email: session.email };
  }

  async function requireAuth(req, res, next) {
    const resolved = await resolveSession(req);
    if (!resolved) {
      if (typeof req.accepts === 'function' && req.accepts('html')) {
        res.redirect('/auth/');
        return;
      }
      res.status(401).json({ error: 'UNAUTHORIZED' });
      return;
    }
    req.auth = resolved;
    res.set('Cache-Control', 'no-store');
    next();
  }

  return {
    resolveSession,
    requireAuth
  };
}
