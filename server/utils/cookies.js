export function buildSessionCookieOptions({ secure, maxAge } = {}) {
  const options = {
    httpOnly: true,
    secure: Boolean(secure),
    sameSite: secure ? 'none' : 'lax'
  };

  if (Number.isFinite(maxAge) && maxAge > 0) {
    options.maxAge = maxAge;
  }

  return options;
}

export function attachSessionCookie(res, name, token, options) {
  const cookieOptions = buildSessionCookieOptions(options);
  res.cookie(name, token, cookieOptions);
  return cookieOptions;
}

export function clearSessionCookie(res, name, { secure } = {}) {
  const options = buildSessionCookieOptions({ secure });
  delete options.maxAge;
  options.expires = new Date(0);
  res.cookie(name, '', options);
  return options;
}
