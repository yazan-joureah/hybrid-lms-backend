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

    if (decoded.courseId !== req.params.courseId || decoded.contentId !== req.params.contentId) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'TICKET_SCOPE_MISMATCH',
          message: 'Streaming ticket is not valid for this file.',
        },
      });
    }

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
