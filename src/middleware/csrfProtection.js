/**
 * Origin-based CSRF protection — replaces the Double-Submit Cookie pattern.
 *
 * RATIONALE (2026 architecture change): This backend is now deployed
 * cross-origin from its frontend (Vercel + Render, two distinct origins).
 * A Double-Submit Cookie scheme requires client-side JS to READ a cookie
 * and echo it in a header — but browsers enforce Same-Origin Policy on
 * `document.cookie` access REGARDLESS of SameSite/Secure settings, making
 * that pattern structurally incompatible with a genuinely cross-origin
 * deployment. No cookie-attribute tuning can fix this.
 *
 * Origin/Referer allow-listing is the standard OWASP-recommended
 * alternative for exactly this case (see OWASP CSRF Prevention Cheat
 * Sheet, "Verifying Origin with Standard Headers"). It works because:
 *   1. The `Origin` header is set by the BROWSER itself on every
 *      cross-site request (fetch/XHR/form) and CANNOT be overridden by
 *      page JavaScript — unlike a cookie value, which a same-site XSS
 *      could read, Origin is tamper-proof from the page's own script.
 *   2. Only ONE endpoint in this API is cookie-authenticated
 *      (POST /auth/refresh) — everywhere else requires a Bearer JWT,
 *      which a cross-site attacker cannot attach (no access to
 *      localStorage/memory of another origin). So this check only needs
 *      to guard that single route.
 */
const env = require('../config/env');
const logger = require('../utils/logger');

// نفس قائمة CORS البيضاء المُعرَّفة في app.js — مصدر واحد للحقيقة
function buildAllowedOrigins() {
  const origins = [env.appUrl, 'http://localhost:5173', 'http://localhost:8443'];
  if (process.env.DEMO_FRONTEND_ORIGIN) {
    origins.push(process.env.DEMO_FRONTEND_ORIGIN);
  }
  return [...new Set(origins.filter(Boolean))];
}

const ALLOWED_ORIGINS = buildAllowedOrigins();

/**
 * Validates Origin (preferred) with a Referer fallback (older browsers /
 * some proxies strip Origin on same-origin GETs, but ALWAYS send it on
 * cross-site state-changing requests — which is exactly the threat model
 * here). Missing BOTH headers on a cookie-authenticated POST is treated
 * as suspicious and rejected — a legitimate browser XHR/fetch always
 * sends at least one.
 */
function requireTrustedOrigin(req, res, next) {
  const origin = req.get('origin');
  const referer = req.get('referer');

  const sourceOrigin = origin || (referer ? new URL(referer).origin : null);

  if (!sourceOrigin || !ALLOWED_ORIGINS.includes(sourceOrigin)) {
    logger.warn('Blocked refresh request — untrusted or missing Origin', {
      origin,
      referer,
      ip: req.ip,
    });
    return res.status(403).json({
      success: false,
      error: { code: 'CSRF_TOKEN_INVALID', message: 'Untrusted request origin.' },
    });
  }

  return next();
}

module.exports = { requireTrustedOrigin, ALLOWED_ORIGINS };
