export function extractTokenFromRequest(req, cookieName) {
  const header = req.get?.('authorization');
  if (header && header.startsWith('Bearer ')) {
    return header.slice(7);
  }

  const fromQuery = req.query?.token;
  if (typeof fromQuery === 'string' && fromQuery.trim()) {
    return fromQuery.trim();
  }

  const cookieToken = req.cookies?.[cookieName];
  if (cookieToken) {
    return cookieToken;
  }

  return null;
}
