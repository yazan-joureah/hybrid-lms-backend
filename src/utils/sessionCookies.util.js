const REFRESH_TOKEN_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function issueSessionCookies(res, refreshTokenRaw) {
  res.cookie('refresh_token', refreshTokenRaw, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    maxAge: REFRESH_TOKEN_COOKIE_MAX_AGE_MS,
  });
}

function clearSessionCookies(res) {
  res.clearCookie('refresh_token', {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
  });
}

module.exports = { issueSessionCookies, clearSessionCookies };
