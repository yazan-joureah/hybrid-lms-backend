const REFRESH_TOKEN_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// الآن دايمًا cross-origin حقيقي (vercel.app ↔ onrender.com) — SameSite=None
// إلزامية بغض النظر عن NODE_ENV، لأنه "production" هنا مو معيار الحسم؛
// معيار الحسم هو "هل الطلب جاي من نطاق مختلف؟" — والجواب نعم دائمًا بهذا setup.
// Secure=true إلزامية أيضًا لأن SameSite=None بدون Secure مرفوضة من كل
// المتصفحات الحديثة (RFC 6265bis).
function issueSessionCookies(res, refreshTokenRaw) {
  res.cookie('refresh_token', refreshTokenRaw, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    maxAge: REFRESH_TOKEN_COOKIE_MAX_AGE_MS,
  });
}

function clearSessionCookies(res) {
  // الخيارات هون لازم تطابق تمامًا خيارات issueSessionCookies وقت التعيين
  // (path/domain/sameSite/secure) وإلا clearCookie بينفّذ بصمت بدون أي أثر.
  res.clearCookie('refresh_token', {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
  });
}

module.exports = { issueSessionCookies, clearSessionCookies };
