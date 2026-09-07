/**
 * Bearer JWT OR scoped Media Stream Ticket authentication.
 * Source: SF-COURSE-03 (Issue Scoped Media Streaming Ticket).
 *
 * Used EXCLUSIVELY on GET /courses/:courseId/content/:contentId/file — the
 * one route where the client is a <video>/<embed> tag, which cannot attach
 * an Authorization header. Every other route keeps using requireAuth
 * unchanged.
 *
 * DEVIATION: if an Authorization header IS present, this fully delegates to
 * requireAuth (same code path as every other route) — the ticket path is
 * only a fallback, never a replacement, for normal Bearer auth. This keeps
 * Admin/instructor tooling that already sends a real Bearer token working
 * with zero behavior change.
 */
const { requireAuth } = require('./authMiddleware');
const { verifyMediaStreamTicket, JwtError } = require('../utils/jwt');

function requireAuthOrStreamTicket(req, res, next) {
  if (req.get('authorization')) {
    return requireAuth(req, res, next);
  }

  const ticket = req.query.stream_ticket;
  if (!ticket) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'MISSING_TOKEN',
        message: 'Authorization Bearer token or stream_ticket is required.',
      },
    });
  }

  try {
    const decoded = verifyMediaStreamTicket(ticket);

    // SECURITY: scope check — a ticket issued for one file must never work
    // on another, even if stolen from browser history/logs (MUC-COURSE
    // analogue). This is the concrete enforcement of "narrow scope", not
    // just documentation.
    if (decoded.courseId !== req.params.courseId || decoded.contentId !== req.params.contentId) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'TICKET_SCOPE_MISMATCH',
          message: 'Streaming ticket is not valid for this file.',
        },
      });
    }

    // sessionId: null — this is not a full login session, only a scoped
    // ticket; nothing downstream should ever rely on req.user.sessionId
    // when this path was taken.
    req.user = { id: decoded.sub, sessionId: null };
    return next();
  } catch (err) {
    if (err instanceof JwtError && err.code === 'EXPIRED') {
      return res.status(401).json({
        success: false,
        error: { code: 'TOKEN_EXPIRED', message: 'Streaming ticket has expired.' },
      });
    }
    return res.status(401).json({
      success: false,
      error: { code: 'TOKEN_INVALID', message: 'Invalid or malformed streaming ticket.' },
    });
  }
}

module.exports = { requireAuthOrStreamTicket };
